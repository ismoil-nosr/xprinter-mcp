// SPDX-License-Identifier: MIT
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { BODY_LIMIT, SCOPES } from './config.js';
import { jwtVerifier, principalFromAuth } from './auth.js';
import type { HttpConfig, TokenVerifier } from './auth.js';
import { createServer } from './server.js';
import type { PrinterService } from './service.js';

export function httpServer(service: PrinterService, config: HttpConfig, verify: TokenVerifier = jwtVerifier(config)) {
    const resource = new URL(config.resource);
    const metadataUrl = `${resource.origin}/.well-known/oauth-protected-resource/mcp`;
    const handler = createMcpHandler(ctx => createServer(service, principalFromAuth(ctx.authInfo)), {
        maxRequestBodySize: BODY_LIMIT, maxSubscriptions: 0, onerror: () => process.stderr.write('MCP request rejected.\n'),
    });
    const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: BODY_LIMIT, onerror: () => process.stderr.write('MCP HTTP conversion failed.\n') });
    const buckets = new Map<string, { count: number; until: number }>();
    let active = 0;
    function limited(key: string): boolean {
        const now = Date.now();
        for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
        const bucket = buckets.get(key) ?? { count: 0, until: now + 60_000 };
        if (buckets.size >= 1024 && !buckets.has(key)) return true;
        buckets.set(key, bucket);
        return ++bucket.count > 120;
    }
    function answer(res: ServerResponse, code: number, data: unknown): void {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data));
    }
    const server = createHttpServer({ maxHeaderSize: 16 * 1024, requestTimeout: 35_000, headersTimeout: 10_000, keepAliveTimeout: 5000 }, (req, res) => {
        void handle(req, res).catch(() => { if (!res.headersSent) answer(res, 500, { error: 'internal_error' }); else res.end(); });
    });
    server.maxConnections = 64;
    async function handle(req: IncomingMessage & { auth?: AuthInfo }, res: ServerResponse): Promise<void> {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const address = server.address();
        const port = address && typeof address !== 'string' ? address.port : config.port;
        const hosts = [resource.host, `127.0.0.1:${port}`, `localhost:${port}`];
        if (!req.headers.host || !hosts.includes(req.headers.host)) { answer(res, 403, { error: 'invalid_host' }); return; }
        const origin = req.headers.origin;
        if (origin !== undefined && (!config.origins.includes(origin) || origin === 'null')) { answer(res, 403, { error: 'invalid_origin' }); return; }
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version, Mcp-Request-Id');
        }
        if (limited(`ip:${req.socket.remoteAddress}`)) { res.setHeader('Retry-After', '60'); answer(res, 429, { error: 'rate_limit' }); return; }
        if (req.url === '/.well-known/oauth-protected-resource/mcp' || req.url === '/.well-known/oauth-protected-resource') {
            if (req.method !== 'GET') { answer(res, 405, { error: 'method_not_allowed' }); return; }
            answer(res, 200, { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: SCOPES,
                bearer_methods_supported: ['header'], resource_name: 'Open Xprinter MCP' }); return;
        }
        if (req.url !== '/mcp') { answer(res, 404, { error: 'not_found' }); return; }
        if (req.method === 'OPTIONS') {
            if (!origin) { answer(res, 403, { error: 'origin_required' }); return; }
            const requested = String(req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(v => v.trim()).filter(Boolean);
            if (requested.some(v => !/^(authorization|content-type|accept|last-event-id|mcp-[a-z0-9-]+)$/.test(v))) { answer(res, 403, { error: 'invalid_cors_headers' }); return; }
            res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': requested.join(', '), 'Access-Control-Max-Age': '600' }); res.end(); return;
        }
        if (!['POST', 'GET', 'DELETE'].includes(req.method ?? '')) { answer(res, 405, { error: 'method_not_allowed' }); return; }
        if (Number(req.headers['content-length'] ?? '0') > BODY_LIMIT) { answer(res, 413, { error: 'body_limit' }); return; }
        const authorization = req.headers.authorization;
        try {
            if (!authorization || !/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(authorization)) throw new Error('Missing bearer token.');
            req.auth = await verify(authorization.slice(7));
        } catch {
            res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"`);
            answer(res, 401, { error: 'unauthorized' }); return;
        }
        if (limited(`owner:${principalFromAuth(req.auth).owner}`)) { res.setHeader('Retry-After', '60'); answer(res, 429, { error: 'rate_limit' }); return; }
        if (active >= 16) { answer(res, 503, { error: 'busy' }); return; }
        active++;
        try { await nodeHandler(req as IncomingMessage & { method: string; url: string; auth?: AuthInfo }, res); } finally { active--; }
    }
    return { server, async close(): Promise<void> {
        await handler.close();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } };
}
