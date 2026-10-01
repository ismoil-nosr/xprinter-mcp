// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { jwtVerifier, loadHttpConfig, principalFromAuth } from '../dist/auth.js';
import { httpServer } from '../dist/http.js';
import { fixture } from './helpers.mjs';
import { request } from 'node:http';

const config = { resource: 'https://printer.example.com/mcp', issuer: 'https://identity.example.com', jwks: 'https://identity.example.com/jwks', port: 0, origins: ['https://ai.example.com'] };
const { privateKey, publicKey } = await generateKeyPair('ES256');
async function token(overrides = {}, key = privateKey) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: config.issuer, aud: config.resource, sub: 'alice', iat: now, exp: now + 300,
        scope: 'xprinter.read xprinter.prepare xprinter.print xprinter.cancel', ...overrides }).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' }).sign(key);
}
async function serving(t) {
    const f = fixture(t);
    const result = httpServer(f.service, config, jwtVerifier(config, publicKey));
    await new Promise(resolve => result.server.listen(0, '127.0.0.1', resolve));
    t.after(() => result.close());
    return { ...f, url: `http://127.0.0.1:${result.server.address().port}/mcp` };
}
test('HTTP configuration refuses plaintext public URLs, credentials and wildcard origins', () => {
    const env = { XPRINTER_PUBLIC_URL: config.resource, XPRINTER_OAUTH_ISSUER: config.issuer, XPRINTER_OAUTH_JWKS_URL: config.jwks };
    assert.equal(loadHttpConfig(env).port, 8787);
    for (const bad of [
        { XPRINTER_PUBLIC_URL: 'http://printer.example.com/mcp' },
        { XPRINTER_PUBLIC_URL: 'https://user:pass@printer.example.com/mcp' },
        { XPRINTER_OAUTH_JWKS_URL: 'file:///tmp/keys' },
        { XPRINTER_ALLOWED_ORIGINS: '*' },
        { XPRINTER_PORT: '0' },
    ]) assert.throws(() => loadHttpConfig({ ...env, ...bad }));
});
test('JWT verification binds issuer, audience, lifetime, signature and identity', async () => {
    const verify = jwtVerifier(config, publicKey);
    const valid = await verify(await token());
    assert.equal(valid.scopes.length, 4); assert.equal(principalFromAuth(valid).owner.length, 64);
    for (const invalid of [
        { iss: 'https://attacker.example.com' }, { aud: 'https://other.example.com/mcp' },
        { exp: Math.floor(Date.now() / 1000) - 10 }, { iat: Math.floor(Date.now() / 1000) + 60 },
        { exp: Math.floor(Date.now() / 1000) + 4000 }, { sub: '' }, { sub: undefined },
    ]) await assert.rejects(verify(await token(invalid)));
    const wrong = await generateKeyPair('ES256');
    await assert.rejects(verify(await token({}, wrong.privateKey)));
    const bob = await verify(await token({ sub: 'bob' }));
    assert.notEqual(principalFromAuth(valid).owner, principalFromAuth(bob).owner);
});
test('HTTP metadata, bearer challenges, Host/Origin guards, CORS and body limits', async t => {
    const { url } = await serving(t), base = new URL(url).origin, access = await token();
    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(metadata.status, 200);
    assert.deepEqual((await metadata.json()).authorization_servers, [config.issuer]);
    const noAuth = await fetch(url, { method: 'POST', body: '{}' });
    assert.equal(noAuth.status, 401); assert.ok(noAuth.headers.get('www-authenticate').includes('resource_metadata='));
    const queryToken = await fetch(`${url}?access_token=${access}`);
    assert.equal(queryToken.status, 404);
    // Fetch normalizes Host; use the raw HTTP client for a DNS-rebinding header.
    const badHost = await new Promise((resolve, reject) => {
        const req = request(url, { method: 'POST', headers: { Host: 'attacker.example.com', Authorization: `Bearer ${access}` } }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject); req.end('{}');
    });
    assert.equal(badHost, 403);
    for (const origin of ['null', 'http://localhost', 'https://attacker.example.com']) {
        const denied = await fetch(url, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${access}` }, body: '{}' });
        assert.equal(denied.status, 403);
    }
    const cors = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://ai.example.com', 'Access-Control-Request-Headers': 'authorization,content-type,mcp-protocol-version,mcp-method,mcp-name' } });
    assert.equal(cors.status, 204); assert.equal(cors.headers.get('access-control-allow-origin'), 'https://ai.example.com');
    const large = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${access}` }, body: 'x'.repeat(3 * 1024 * 1024 + 1) });
    assert.equal(large.status, 413);
    const invalid = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer invalid-token' }, body: '{}' });
    assert.equal(invalid.status, 401);
});
for (const [era, options] of [['2025 compatibility', {}], ['2026-07-28', { versionNegotiation: { pin: '2026-07-28' } }]]) {
    test(`authenticated HTTP: ${era}, identity isolation and scope challenges`, async t => {
        const { url, printer } = await serving(t);
        async function clientFor(scope, sub = 'alice') {
            const client = new Client({ name: 'http-test', version: '1.0.0' }, options);
            const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${await token({ scope, sub })}` } } });
            await client.connect(transport); t.after(() => client.close()); return client;
        }
        const alice = await clientFor('xprinter.read xprinter.prepare xprinter.print');
        assert.equal((await alice.listTools()).tools.length, 8);
        const prepared = await alice.callTool({ name: 'prepare_labels', arguments: { labels: [{ kind: 'qr', code: 'PRIVATE-ORDER-123' }] } });
        assert.equal(prepared.isError, undefined);
        const { artifactId } = prepared.structuredContent;
        const bob = await clientFor('xprinter.read xprinter.prepare xprinter.print', 'bob');
        const denied = await bob.callTool({ name: 'preview_label', arguments: { artifactId } });
        assert.equal(denied.isError, true); assert.equal(denied.structuredContent.error, 'artifact_unavailable');
        const readonly = await clientFor('xprinter.read');
        await assert.rejects(readonly.callTool({ name: 'prepare_labels', arguments: { labels: [{ kind: 'qr', code: 'x' }] } }));
        assert.equal(printer.submissions.length, 0);
    });
}
