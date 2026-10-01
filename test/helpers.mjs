// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCOPES } from '../dist/config.js';
import { Store } from '../dist/store.js';
import { PrinterService } from '../dist/service.js';

export const principal = { owner: 'alice', scopes: SCOPES };
export const other = { owner: 'bob', scopes: SCOPES };
export const profile = { widthMm: 58, heightMm: 40, stock: 'gap', gapMm: 2, darkness: 7 };
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5iUAAAAASUVORK5CYII=', 'base64');
export function fixture(t, overrides = {}) {
    const dir = overrides.stateDir ?? mkdtempSync(join(tmpdir(), 'xprinter-mcp-test-'));
    const config = { stateDir: dir, renderer: '/not-used', allowPrint: true, maxLabelsPerJob: 100, maxLabelsPerHour: 500, language: 'en', ...overrides };
    const store = new Store(dir, overrides.now ?? Date.now);
    const renderer = { async render(request) { return { pdf: Buffer.from('%PDF-1.4\nfixture only'), preview: png, pages: request.labels?.reduce((n, l) => n + l.quantity, 0) ?? 1 }; } };
    const printer = {
        submissions: [], cancelled: [], fail: false,
        async status() { return { queue: 'XP330B_OpenSource', configured: true, enabled: true, acceptingJobs: true, state: 'idle', pendingJobs: 0, hardwareVerified: false }; },
        async submit(pdf, stock, copies, jobId) { this.submissions.push({ pdf, stock, copies, jobId }); if (this.fail) throw new Error('simulated lost response'); return 42; },
        async jobState() { return 'completed'; },
        async cancel(job) { this.cancelled.push(job.jobId); },
    };
    const service = new PrinterService(config, store, renderer, printer);
    t?.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
    return { dir, config, store, renderer, printer, service };
}
export function prepare(service, p = principal, quantity = 1) {
    return service.prepareLabels(p, { profile, labels: [{ kind: 'qr', title: '商品 · Товар', code: '中文测试-123', footer: '¥25', quantity }] });
}
