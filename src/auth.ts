// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey, JWK } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { SCOPES } from './config.js';
import type { Principal } from './config.js';

const httpsUrl = z.url().refine(v => { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }, 'Use an HTTPS URL without credentials, query or fragment.');
export interface HttpConfig { resource: string; issuer: string; jwks: string; port: number; origins: readonly string[]; listenHost?: '127.0.0.1' | '0.0.0.0' }
export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
    return z.object({
        resource: httpsUrl.refine(v => new URL(v).pathname === '/mcp', 'The public resource URL must end in /mcp.'),
        issuer: httpsUrl, jwks: httpsUrl, port: z.coerce.number().int().min(1024).max(65535),
        origins: z.array(httpsUrl.refine(v => new URL(v).origin === v, 'Use exact origins without trailing slashes or paths.')).max(16),
        listenHost: z.enum(['127.0.0.1', '0.0.0.0']),
    }).parse({ resource: env.XPRINTER_PUBLIC_URL, issuer: env.XPRINTER_OAUTH_ISSUER, jwks: env.XPRINTER_OAUTH_JWKS_URL,
        port: env.XPRINTER_PORT ?? '8787', origins: env.XPRINTER_ALLOWED_ORIGINS?.split(',').filter(Boolean) ?? [], listenHost: env.XPRINTER_LISTEN_HOST ?? '127.0.0.1' });
}
export type TokenVerifier = (token: string) => Promise<AuthInfo>;
export function jwtVerifier(config: HttpConfig, key?: CryptoKey | KeyObject | Uint8Array | JWK | JWTVerifyGetKey): TokenVerifier {
    const resolver = key ?? createRemoteJWKSet(new URL(config.jwks), { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 600_000 });
    return async token => {
        // No token passthrough: only a verified, audience-bound resource-server token
        // yields a principal. CUPS never receives credentials from a remote client.
        const { payload } = await jwtVerify(token, resolver as JWTVerifyGetKey, {
            issuer: config.issuer, audience: config.resource, algorithms: ['RS256', 'ES256', 'EdDSA'],
            requiredClaims: ['exp', 'iat', 'sub'], clockTolerance: 5,
        });
        if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256 || typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || payload.exp <= payload.iat || payload.exp - payload.iat > 3600 || payload.iat > Date.now() / 1000 + 5) throw new Error('Invalid identity or token lifetime.');
        const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(s => SCOPES.includes(s as typeof SCOPES[number])) : [];
        const owner = createHash('sha256').update(JSON.stringify([config.issuer, payload.sub])).digest('hex');
        return { token, clientId: typeof payload.azp === 'string' ? payload.azp : owner, scopes, expiresAt: payload.exp,
            resource: new URL(config.resource), resourceMetadataUrl: `${new URL(config.resource).origin}/.well-known/oauth-protected-resource/mcp`, extra: { owner } };
    };
}
export function principalFromAuth(info: AuthInfo | undefined): Principal {
    if (!info || typeof info.extra?.owner !== 'string') throw new Error('Missing verified authentication context.');
    return { owner: info.extra.owner, scopes: info.scopes };
}
