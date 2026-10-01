// SPDX-License-Identifier: MIT
import { PublicError, QUEUE, requireScope } from './config.js';
import type { Config, Principal } from './config.js';
import type { PrinterBackend, Renderer } from './native.js';
import type { Artifact, ArtifactSummary, Job, PrepareLabels, PreparePdf } from './schema.js';
import { Store } from './store.js';

export class PrinterService {
    private renders = 0;
    constructor(readonly config: Config, readonly store: Store, readonly renderer: Renderer, readonly printer: PrinterBackend) {}
    capabilities() {
        return { queue: QUEUE, backend: 'macOS CUPS USB', model: 'XP-330B', dpi: 203, nativeDriverMinimum: '0.3.1',
            widthMm: { min: 20, max: 76 }, heightMm: { min: 10, max: 200 }, stocks: ['gap', 'black-mark', 'continuous'],
            labelKinds: ['code128', 'qr', 'text'], defaultProfile: { widthMm: 58, heightMm: 40, stock: 'gap', gapMm: 2, darkness: 7 },
            printEnabled: this.config.allowPrint, maxLabelsPerJob: this.config.maxLabelsPerJob, maxLabelsPerHour: this.config.maxLabelsPerHour,
            artifactLifetimeMinutes: 15, previewPages: 'first page only', physicalOutputVerified: false };
    }
    summary(a: Artifact): ArtifactSummary { const { pdf: _pdf, preview: _preview, ...summary } = a; return summary; }
    private async render(owner: string, profile: PrepareLabels['profile'], request: Record<string, unknown>): Promise<Artifact> {
        if (this.renders >= 2) throw new PublicError('busy', 'Two labels are already rendering. Retry later.');
        this.renders++;
        try { return this.store.put(owner, profile, await this.renderer.render(request)); }
        finally { this.renders--; }
    }
    async prepareLabels(p: Principal, input: PrepareLabels): Promise<Artifact> {
        requireScope(p, 'xprinter.prepare');
        const pixels = Math.round(input.profile.widthMm * 203 / 25.4) * Math.round(input.profile.heightMm * 203 / 25.4);
        if (pixels * input.labels.reduce((n, l) => n + l.quantity, 0) > 40_000_000) throw new PublicError('batch_limit', 'Split this batch into smaller batches.');
        return this.render(p.owner, input.profile, { widthMm: input.profile.widthMm, heightMm: input.profile.heightMm, labels: input.labels });
    }
    async preparePdf(p: Principal, input: PreparePdf): Promise<Artifact> {
        requireScope(p, 'xprinter.prepare');
        const source = Buffer.from(input.pdfBase64, 'base64');
        if (source.length > 2 * 1024 * 1024 || !source.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new PublicError('invalid_pdf', 'Supply a PDF smaller than 2 MiB.');
        return this.render(p.owner, input.profile, { widthMm: input.profile.widthMm, heightMm: input.profile.heightMm, pdfBase64: input.pdfBase64, rotate: input.rotate });
    }
    preview(p: Principal, id: string): Artifact { requireScope(p, 'xprinter.prepare'); return this.store.artifact(p.owner, id); }
    async print(p: Principal, artifact: string, copies: number, key: string, signal?: AbortSignal): Promise<Job & { replayed: boolean }> {
        requireScope(p, 'xprinter.print');
        if (!this.config.allowPrint) throw new PublicError('print_disabled', 'The operator must set XPRINTER_ALLOW_PRINT=1 to permit physical printing.');
        if (signal?.aborted) throw new PublicError('request_cancelled', 'The print request was cancelled before dispatch.');
        const prior = this.store.existing(p.owner, key, artifact, copies);
        if (prior) return { ...prior, replayed: true };
        const prepared = this.store.artifact(p.owner, artifact);
        const state = await this.printer.status();
        if (signal?.aborted) throw new PublicError('request_cancelled', 'The print request was cancelled before dispatch.');
        if (!state.configured || !state.enabled || !state.acceptingJobs) throw new PublicError('printer_unavailable', 'The Open Xprinter USB queue must be configured, enabled and accepting jobs.');
        const reservation = this.store.reserve(p.owner, key, artifact, copies, this.config.maxLabelsPerJob, this.config.maxLabelsPerHour);
        if (!reservation.dispatch) return { ...reservation.job, replayed: true };
        try {
            const cupsId = await this.printer.submit(prepared.pdf, prepared.profile, copies, reservation.job.jobId, signal);
            return { ...this.store.submitted(p.owner, reservation.job.jobId, cupsId), replayed: false };
        } catch {
            // A timeout, disconnect or crash may occur after CUPS accepted the job.
            // Keep the durable reservation; do not guess that retrying is safe.
            return { ...this.store.job(p.owner, reservation.job.jobId), replayed: false };
        }
    }
    async jobStatus(p: Principal, id: string) {
        requireScope(p, 'xprinter.read');
        const job = this.store.job(p.owner, id);
        return { ...job, spoolerState: job.cupsJobId === null ? 'unknown' : await this.printer.jobState(job),
            physicalOutputVerified: false, advice: job.state === 'uncertain' ? 'Inspect the Mac queue and physical labels before using a NEW idempotency key.' : 'CUPS completion does not confirm physical label alignment or barcode readability.' };
    }
    async cancel(p: Principal, id: string, signal?: AbortSignal): Promise<Job> {
        requireScope(p, 'xprinter.cancel');
        if (!this.config.allowPrint) throw new PublicError('print_disabled', 'The operator has disabled printer mutations.');
        const job = this.store.job(p.owner, id);
        if (job.state === 'cancelled') return job;
        if (signal?.aborted) throw new PublicError('request_cancelled', 'The cancellation request was aborted before dispatch.');
        await this.printer.cancel(job, signal);
        return this.store.cancelled(p.owner, id);
    }
}
