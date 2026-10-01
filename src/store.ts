// SPDX-License-Identifier: MIT
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PublicError } from './config.js';
import type { Artifact, Job, Profile, Rendered } from './schema.js';

export class Store {
    private readonly db: DatabaseSync;
    constructor(directory: string, private readonly now: () => number = Date.now) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const dir = lstatSync(directory);
        if (dir.isSymbolicLink() || !dir.isDirectory() || (process.getuid && dir.uid !== process.getuid())) throw new Error('State directory must be owned by this user and must not be a symlink.');
        chmodSync(directory, 0o700);
        const file = join(directory, 'state.sqlite');
        if (!existsSync(file)) {
            try { closeSync(openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        for (const path of [file, `${file}-wal`, `${file}-shm`]) {
            if (!existsSync(path)) continue;
            const stat = lstatSync(path);
            if (!stat.isFile() || stat.uid !== dir.uid) throw new Error('Unsafe state database path.');
            chmodSync(path, 0o600);
        }
        this.db = new DatabaseSync(file);
        this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, profile TEXT NOT NULL, pages INTEGER NOT NULL,
                pdf BLOB NOT NULL, preview BLOB NOT NULL, expires INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
                artifact TEXT NOT NULL, copies INTEGER NOT NULL, labels INTEGER NOT NULL, state TEXT NOT NULL,
                cups_id INTEGER, created INTEGER NOT NULL, UNIQUE(owner, request_key)
            );
            CREATE INDEX IF NOT EXISTS artifact_expiry ON artifacts(expires);
            CREATE INDEX IF NOT EXISTS job_budget ON jobs(created);
            CREATE TABLE IF NOT EXISTS backend_binding (id INTEGER PRIMARY KEY CHECK (id=1), fingerprint TEXT NOT NULL);
        `);
        this.cleanup();
    }
    close(): void { this.db.close(); }
    bindBackend(identity: string): void {
        const fingerprint = createHash('sha256').update(identity).digest('hex');
        this.transaction(() => {
            this.db.prepare('INSERT OR IGNORE INTO backend_binding VALUES (1,?)').run(fingerprint);
            if (this.db.prepare('SELECT fingerprint FROM backend_binding WHERE id=1').get()!.fingerprint !== fingerprint) {
                throw new PublicError('backend_changed', 'This state volume belongs to another printer host/account. Restore its original backend configuration; do not erase retry receipts.');
            }
        });
    }
    private transaction<T>(run: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try { const result = run(); this.db.exec('COMMIT'); return result; }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    cleanup(): void {
        this.db.prepare('DELETE FROM artifacts WHERE expires <= ?').run(this.now());
        this.db.prepare('DELETE FROM jobs WHERE created < ?').run(this.now() - 30 * 86400_000);
        // A local checkpoint limits retained label data in the WAL. Backups/SSD snapshots
        // remain outside this process's erasure guarantees.
        this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    }
    put(owner: string, profile: Profile, rendered: Rendered): Artifact {
        return this.transaction(() => {
            this.db.prepare('DELETE FROM artifacts WHERE expires <= ?').run(this.now());
            const used = this.db.prepare('SELECT count(*) AS count, coalesce(sum(length(pdf)+length(preview)),0) AS bytes FROM artifacts').get()!;
            if (Number(used.count) >= 128 || Number(used.bytes) + rendered.pdf.length + rendered.preview.length > 64 * 1024 * 1024) {
                throw new PublicError('storage_limit', 'Preview storage is full. Wait for prepared labels to expire.');
            }
            const id = randomUUID(), expires = this.now() + 15 * 60_000;
            this.db.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?)').run(id, owner, JSON.stringify(profile), rendered.pages, rendered.pdf, rendered.preview, expires);
            return { artifactId: id, profile, expiresAt: new Date(expires).toISOString(), previewPage: 1, ...rendered };
        });
    }
    artifact(owner: string, id: string): Artifact {
        const row = this.db.prepare('SELECT * FROM artifacts WHERE owner=? AND id=? AND expires>?').get(owner, id, this.now());
        if (!row) throw new PublicError('artifact_unavailable', 'Prepared label is unavailable or expired. Prepare it again.');
        return {
            artifactId: String(row.id), pages: Number(row.pages), profile: JSON.parse(String(row.profile)) as Profile,
            expiresAt: new Date(Number(row.expires)).toISOString(), previewPage: 1,
            pdf: Buffer.from(row.pdf as Uint8Array), preview: Buffer.from(row.preview as Uint8Array),
        };
    }
    private jobFrom(row: Record<string, unknown>): Job {
        return { jobId: String(row.id), artifactId: String(row.artifact), copies: Number(row.copies), labels: Number(row.labels),
            state: row.state as Job['state'], cupsJobId: row.cups_id === null ? null : Number(row.cups_id), createdAt: new Date(Number(row.created)).toISOString() };
    }
    private fingerprint(artifact: string, copies: number): string { return createHash('sha256').update(JSON.stringify([artifact, copies])).digest('hex'); }
    existing(owner: string, key: string, artifact: string, copies: number): Job | undefined {
        const row = this.db.prepare('SELECT * FROM jobs WHERE owner=? AND request_key=?').get(owner, key);
        if (!row) return undefined;
        if (row.fingerprint !== this.fingerprint(artifact, copies)) throw new PublicError('idempotency_conflict', 'This key already belongs to a different print request.');
        return this.jobFrom(row);
    }
    reserve(owner: string, key: string, artifact: string, copies: number, maxJob: number, maxHour: number): { job: Job; dispatch: boolean } {
        return this.transaction(() => {
            const existing = this.existing(owner, key, artifact, copies);
            if (existing) return { job: existing, dispatch: false };
            const prepared = this.artifact(owner, artifact), labels = prepared.pages * copies;
            if (labels > maxJob) throw new PublicError('job_limit', `At most ${maxJob} physical labels per job.`);
            const used = Number(this.db.prepare('SELECT coalesce(sum(labels),0) AS n FROM jobs WHERE created>?').get(this.now() - 3600_000)!.n);
            if (used + labels > maxHour) throw new PublicError('hour_limit', 'The printer hourly label budget has been reached.');
            const id = randomUUID(), created = this.now();
            // Reserve BEFORE the external CUPS side effect. A crash leaves an uncertain
            // receipt and retries return it; automatic replay would risk duplicate paper.
            this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,NULL,?)').run(id, owner, key, this.fingerprint(artifact, copies), artifact, copies, labels, 'uncertain', created);
            return { job: { jobId: id, artifactId: artifact, copies, labels, state: 'uncertain', cupsJobId: null, createdAt: new Date(created).toISOString() }, dispatch: true };
        });
    }
    job(owner: string, id: string): Job {
        const row = this.db.prepare('SELECT * FROM jobs WHERE owner=? AND id=?').get(owner, id);
        if (!row) throw new PublicError('job_unavailable', 'Print job is unavailable.');
        return this.jobFrom(row);
    }
    submitted(owner: string, id: string, cupsId: number): Job {
        this.db.prepare("UPDATE jobs SET state='submitted', cups_id=? WHERE owner=? AND id=? AND state='uncertain'").run(cupsId, owner, id);
        return this.job(owner, id);
    }
    cancelled(owner: string, id: string): Job {
        this.db.prepare("UPDATE jobs SET state='cancelled' WHERE owner=? AND id=?").run(owner, id);
        return this.job(owner, id);
    }
}
