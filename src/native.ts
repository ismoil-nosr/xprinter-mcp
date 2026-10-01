// SPDX-License-Identifier: MIT
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { z } from 'zod';
import { PublicError, QUEUE } from './config.js';
import type { Config } from './config.js';
import { renderResponseSchema } from './schema.js';
import type { Job, Profile, Rendered } from './schema.js';

export interface PrinterStatus {
    queue: string; configured: boolean; enabled: boolean; acceptingJobs: boolean;
    state: 'idle' | 'printing' | 'stopped' | 'unavailable'; pendingJobs: number;
    hardwareVerified: boolean;
}
export interface Renderer { render(request: Record<string, unknown>): Promise<Rendered> }
export interface PrinterBackend {
    status(): Promise<PrinterStatus>;
    submit(pdf: Buffer, profile: Profile, copies: number, jobId: string, signal?: AbortSignal): Promise<number>;
    jobState(job: Job): Promise<string>;
    cancel(job: Job, signal?: AbortSignal): Promise<void>;
}

export function command(executable: string, args: readonly string[], input?: Buffer, limit = 1024 * 1024, timeout = 10_000, allowFailureOutput = false): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, [...args], { shell: false, stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, LC_ALL: 'C', LANG: 'C', CUPS_SERVER: '/private/var/run/cupsd', CUPS_ENCRYPTION: 'IfRequested' } });
        const chunks: Buffer[] = [];
        let bytes = 0, failed = false;
        const timer = setTimeout(() => fail(new PublicError('command_timeout', 'A local printer operation timed out.')), timeout);
        function fail(error: Error): void {
            if (failed) return;
            failed = true; clearTimeout(timer); child.kill('SIGKILL'); reject(error);
        }
        child.on('error', () => fail(new PublicError('native_unavailable', 'Required macOS printer tools are unavailable.')));
        child.stdin.on('error', () => {});
        // Never forward native stderr: it can contain file paths or label data.
        child.stderr.on('data', () => {});
        child.stdout.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > limit) fail(new PublicError('output_limit', 'The local operation exceeded its output limit.'));
            else chunks.push(chunk);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (failed) return;
            if (code !== 0 && !allowFailureOutput) reject(new PublicError('native_failed', 'The local printer operation failed. Check the Mac printer queue or run xprinter-mcp doctor.'));
            else resolve(Buffer.concat(chunks));
        });
        child.stdin.end(input);
    });
}
function assertMac(): void {
    if (process.platform !== 'darwin') throw new PublicError('unsupported_host', 'The USB printer backend currently requires macOS. Connect from Windows/Linux to the Mac via MCP over SSH or HTTPS.');
}
async function temporary<T>(run: (folder: string) => Promise<T>): Promise<T> {
    const folder = await mkdtemp(join(tmpdir(), 'open-xprinter-mcp-'));
    await chmod(folder, 0o700);
    try { return await run(folder); }
    finally { await rm(folder, { recursive: true, force: true }); }
}
export class NativeRenderer implements Renderer {
    constructor(private readonly config: Config) {}
    async render(request: Record<string, unknown>): Promise<Rendered> {
        assertMac();
        const info = join(dirname(dirname(this.config.renderer)), 'Info.plist');
        // Prevent an older app from treating an unknown flag as a request to open its GUI.
        const version = (await command('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', info])).toString().trim();
        if (!/^\d+\.\d+\.\d+$/.test(version) || version.localeCompare('0.3.0', undefined, { numeric: true }) < 0) {
            throw new PublicError('driver_upgrade', 'Install Open Xprinter 0.3.0 or newer before using MCP.');
        }
        const output = JSON.parse((await command(this.config.renderer, ['--mcp-render'], Buffer.from(JSON.stringify(request)), 16 * 1024 * 1024, 30_000, true)).toString()) as unknown;
        const failure = z.object({ error: z.string().max(500) }).safeParse(output);
        if (failure.success) throw new PublicError('invalid_label', failure.data.error);
        const result = renderResponseSchema.parse(output);
        if (result.widthMm !== request.widthMm || result.heightMm !== request.heightMm) throw new Error('Renderer dimensions changed.');
        const pdf = Buffer.from(result.pdfBase64, 'base64'), preview = Buffer.from(result.previewBase64, 'base64');
        if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')) || !preview.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid renderer output.');
        return { pdf, preview, pages: result.pages };
    }
}
const standardSizes = new Set(['30x20', '40x30', '50x30', '50x50', '58x40', '60x40', '70x50', '76x50', '58x100', '76x150']);
export function printArguments(profile: Profile, copies: number, jobId: string, file: string): string[] {
    const { widthMm: w, heightMm: h } = profile;
    const media = standardSizes.has(`${w}x${h}`) ? (w > h ? `${h}x${w}mmRotated.Fullbleed` : `${w}x${h}mm.Fullbleed`) : `Custom.${w}x${h}mm`;
    return ['-d', QUEUE, '-n', String(copies), '-t', `Open Xprinter MCP ${jobId}`,
        '-o', `PageSize=${media}`, '-o', 'Resolution=203dpi', '-o', 'MediaMethod=Direct',
        '-o', `PaperType=${{ gap: 'LabelGaps', 'black-mark': 'LabelMark', continuous: 'Continue' }[profile.stock]}`,
        '-o', `GapsHeight=${profile.stock === 'continuous' ? 0 : profile.gapMm}`, '-o', `Darkness=${profile.darkness}`,
        '-o', 'PrintSpeed=3', '-o', 'fit-to-page=false', '-o', 'scaling=100', '-o', 'number-up=1', '-o', 'sides=one-sided', file];
}

export function verifyJobIdentity(attributes: Record<string, unknown>, job: Job): { state: number } {
    let uri: URL;
    try { uri = new URL(String(attributes['job-printer-uri'])); } catch { throw new PublicError('job_identity', 'Missing CUPS printer identity.'); }
    if (job.cupsJobId === null || attributes['job-id'] !== job.cupsJobId || attributes['job-name'] !== `Open Xprinter MCP ${job.jobId}` || uri.pathname !== `/printers/${QUEUE}` || !['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)) {
        throw new PublicError('job_identity', 'CUPS no longer exposes a matching MCP job. Cancellation is refused.');
    }
    return { state: z.number().int().min(3).max(9).parse(attributes['job-state']) };
}

export class CupsPrinter implements PrinterBackend {
    async status(): Promise<PrinterStatus> {
        assertMac();
        const unavailable: PrinterStatus = { queue: QUEUE, configured: false, enabled: false, acceptingJobs: false, state: 'unavailable', pendingJobs: 0, hardwareVerified: false };
        try {
            const [device, printer, acceptance, options, pending] = await Promise.all([
                command('/usr/bin/lpstat', ['-v', QUEUE]), command('/usr/bin/lpstat', ['-p', QUEUE]),
                command('/usr/bin/lpstat', ['-a', QUEUE]), command('/usr/bin/lpoptions', ['-p', QUEUE, '-l']),
                command('/usr/bin/lpstat', ['-W', 'not-completed', '-o', QUEUE]),
            ]);
            if (!/^device for XP330B_OpenSource: usb:\/\/Xprinter\/XP-330B(?:\?|\s|$)/i.test(device.toString()) || !options.toString().includes('Resolution/Resolution: *203dpi') || !options.toString().includes('40x58mmRotated.Fullbleed')) return unavailable;
            const text = printer.toString();
            return { queue: QUEUE, configured: true, enabled: /\benabled since\b/.test(text),
                acceptingJobs: acceptance.toString().startsWith(`${QUEUE} accepting requests`),
                state: text.includes('is idle.') ? 'idle' : text.includes('now printing') ? 'printing' : 'stopped',
                pendingJobs: pending.toString().split('\n').filter(v => v.startsWith(`${QUEUE}-`)).length, hardwareVerified: false };
        } catch { return unavailable; }
    }
    async submit(pdf: Buffer, profile: Profile, copies: number, jobId: string, signal?: AbortSignal): Promise<number> {
        assertMac();
        return temporary(async folder => {
            const file = join(folder, 'labels.pdf');
            await writeFile(file, pdf, { mode: 0o600, flag: 'wx' });
            if (signal?.aborted) throw new PublicError('request_cancelled', 'The request was cancelled before CUPS dispatch.');
            const text = (await command('/usr/bin/lp', printArguments(profile, copies, jobId, file))).toString();
            const match = /^request id is XP330B_OpenSource-(\d+)\b/.exec(text);
            if (!match || !Number.isSafeInteger(Number(match[1]))) throw new PublicError('submission_uncertain', 'CUPS did not return a verifiable job receipt. Inspect the Mac queue before trying another key.');
            return Number(match[1]);
        });
    }
    private async verifiedJob(job: Job): Promise<{ state: number }> {
        assertMac();
        if (job.cupsJobId === null) throw new PublicError('submission_uncertain', 'Submission is uncertain. Inspect the Mac queue; this server cannot cancel an unidentified job.');
        return temporary(async folder => {
            const file = join(folder, 'job.test');
            await writeFile(file, `{
 OPERATION Get-Job-Attributes
 GROUP operation-attributes-tag
 ATTR charset attributes-charset utf-8
 ATTR language attributes-natural-language en
 ATTR uri job-uri ipp://localhost/jobs/$job-id
 ATTR name requesting-user-name $owner
 ATTR keyword requested-attributes job-id,job-name,job-printer-uri,job-state
 STATUS successful-ok
}\n`, { mode: 0o600, flag: 'wx' });
            const xml = await command('/usr/bin/ipptool', ['-X', '-T', '5', '-d', `job-id=${job.cupsJobId}`, '-d', `owner=${userInfo().username}`, `ipp://localhost/printers/${QUEUE}`, file]);
            const report = z.object({ Successful: z.literal(true), Tests: z.array(z.object({ ResponseAttributes: z.array(z.record(z.string(), z.unknown())) })) }).parse(JSON.parse((await command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], xml)).toString()));
            const attributes = Object.assign({}, ...report.Tests.flatMap(t => t.ResponseAttributes)) as Record<string, unknown>;
            return verifyJobIdentity(attributes, job);
        });
    }
    async jobState(job: Job): Promise<string> {
        try { return ({ 3: 'pending', 4: 'held', 5: 'processing', 6: 'stopped', 7: 'cancelled', 8: 'aborted', 9: 'completed' } as Record<number, string>)[(await this.verifiedJob(job)).state]!; }
        catch { return 'unavailable-or-unverifiable'; }
    }
    async cancel(job: Job, signal?: AbortSignal): Promise<void> {
        const { state } = await this.verifiedJob(job);
        if (state >= 7) throw new PublicError('job_finished', 'This job already finished. Printed labels cannot be undone.');
        if (signal?.aborted) throw new PublicError('request_cancelled', 'The cancellation request was aborted before dispatch.');
        await command('/usr/bin/cancel', [`${QUEUE}-${job.cupsJobId}`]);
    }
}
