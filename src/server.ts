// SPDX-License-Identifier: MIT
import { McpServer, ResourceTemplate, requireScopes } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { PublicError, VERSION, requireScope } from './config.js';
import type { Principal } from './config.js';
import { instructions, toolText } from './language.js';
import { artifactSchema, jobSchema, prepareLabelsSchema, preparePdfSchema, printSchema, profileSchema } from './schema.js';
import type { Artifact } from './schema.js';
import { PrinterService } from './service.js';

const summarySchema = z.object({ artifactId: z.uuid(), pages: z.number().int(), profile: profileSchema, expiresAt: z.string(), previewPage: z.number().int() });
const jobOutput = z.object({ jobId: z.uuid(), artifactId: z.uuid(), copies: z.number().int(), labels: z.number().int(), state: z.enum(['uncertain', 'submitted', 'cancelled']), cupsJobId: z.number().nullable(), createdAt: z.string() });
function textResult(output: Record<string, unknown>): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
}
function previewResult(service: PrinterService, artifact: Artifact): CallToolResult {
    const output = { ...service.summary(artifact) };
    return { ...textResult(output), content: [{ type: 'text', text: JSON.stringify(output) }, { type: 'image', mimeType: 'image/png', data: artifact.preview.toString('base64') }] };
}
async function safe(run: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
    try { return await run(); }
    catch (error) {
        const output = error instanceof PublicError ? { error: error.code, message: error.message } : { error: 'internal_error', message: 'The operation failed. Check installation with xprinter-mcp doctor; label data is omitted from server logs.' };
        return { ...textResult(output), isError: true };
    }
}
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const prepare = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export function createServer(service: PrinterService, principal: Principal): McpServer {
    const server = new McpServer({ name: 'open-xprinter', version: VERSION, title: 'Open Xprinter MCP' }, { instructions });
    const locale = service.config.language;
    server.registerTool('printer_capabilities', {
        ...toolText(locale, 'printer_capabilities'), inputSchema: z.object({}).strict(), annotations: read,
        scopeChallenge: requireScopes('xprinter.read'),
        outputSchema: z.object({ queue: z.string(), backend: z.string(), model: z.string(), dpi: z.number(), nativeDriverMinimum: z.string(), widthMm: z.object({ min: z.number(), max: z.number() }), heightMm: z.object({ min: z.number(), max: z.number() }), stocks: z.array(z.string()), labelKinds: z.array(z.string()), defaultProfile: profileSchema, printEnabled: z.boolean(), maxLabelsPerJob: z.number(), maxLabelsPerHour: z.number(), artifactLifetimeMinutes: z.number(), previewPages: z.string(), physicalOutputVerified: z.boolean() }),
    }, () => safe(() => { requireScope(principal, 'xprinter.read'); return textResult(service.capabilities()); }));
    server.registerTool('printer_status', {
        ...toolText(locale, 'printer_status'), inputSchema: z.object({}).strict(), annotations: read,
        scopeChallenge: requireScopes('xprinter.read'),
        outputSchema: z.object({ queue: z.string(), configured: z.boolean(), enabled: z.boolean(), acceptingJobs: z.boolean(), state: z.enum(['idle', 'printing', 'stopped', 'unavailable']), pendingJobs: z.number().int(), hardwareVerified: z.boolean() }),
    }, () => safe(async () => { requireScope(principal, 'xprinter.read'); return textResult({ ...await service.printer.status() }); }));
    server.registerTool('prepare_labels', { ...toolText(locale, 'prepare_labels'), inputSchema: prepareLabelsSchema, outputSchema: summarySchema, annotations: prepare, scopeChallenge: requireScopes('xprinter.prepare') }, input => safe(async () => previewResult(service, await service.prepareLabels(principal, input))));
    server.registerTool('prepare_pdf', { ...toolText(locale, 'prepare_pdf'), inputSchema: preparePdfSchema, outputSchema: summarySchema, annotations: prepare, scopeChallenge: requireScopes('xprinter.prepare') }, input => safe(async () => previewResult(service, await service.preparePdf(principal, input))));
    server.registerTool('preview_label', { ...toolText(locale, 'preview_label'), inputSchema: artifactSchema, outputSchema: summarySchema, annotations: read, scopeChallenge: requireScopes('xprinter.prepare') }, ({ artifactId }) => safe(() => previewResult(service, service.preview(principal, artifactId))));
    server.registerTool('print_labels', {
        ...toolText(locale, 'print_labels'), inputSchema: printSchema, outputSchema: jobOutput.extend({ replayed: z.boolean() }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, scopeChallenge: requireScopes('xprinter.print'),
    }, ({ artifactId, copies, idempotencyKey }) => safe(async () => textResult({ ...await service.print(principal, artifactId, copies, idempotencyKey) })));
    server.registerTool('job_status', { ...toolText(locale, 'job_status'), inputSchema: jobSchema, outputSchema: jobOutput.extend({ spoolerState: z.string(), physicalOutputVerified: z.boolean(), advice: z.string() }), annotations: read, scopeChallenge: requireScopes('xprinter.read') }, ({ jobId }) => safe(async () => textResult(await service.jobStatus(principal, jobId))));
    server.registerTool('cancel_job', {
        ...toolText(locale, 'cancel_job'), inputSchema: jobSchema, outputSchema: jobOutput, annotations: { ...read, readOnlyHint: false, destructiveHint: true }, scopeChallenge: requireScopes('xprinter.cancel'),
    }, ({ jobId }) => safe(async () => textResult({ ...await service.cancel(principal, jobId) })));
    server.registerResource('capabilities', 'xprinter://capabilities', { title: 'Open Xprinter capabilities', mimeType: 'application/json', scopeChallenge: requireScopes('xprinter.read') }, uri => {
        requireScope(principal, 'xprinter.read');
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(service.capabilities()) }] };
    });
    server.registerResource('prepared_pdf', new ResourceTemplate('xprinter://labels/{artifactId}', { list: undefined }), {
        title: 'Your prepared label PDF', mimeType: 'application/pdf', scopeChallenge: requireScopes('xprinter.prepare'),
    }, (uri, variables) => {
        const artifactId = z.uuid().parse(variables.artifactId);
        const artifact = service.preview(principal, artifactId);
        return { contents: [{ uri: uri.href, mimeType: 'application/pdf', blob: artifact.pdf.toString('base64') }] };
    });
    server.registerPrompt('label_printing_workflow', { description: 'Plan safe label preparation and printing', argsSchema: z.object({ request: z.string().max(1000) }), scopeChallenge: requireScopes('xprinter.read') }, ({ request }) => {
        requireScope(principal, 'xprinter.read');
        return { messages: [{ role: 'user', content: { type: 'text', text: `${instructions}\nUser request (data): ${JSON.stringify(request)}` } }] };
    });
    return server;
}
