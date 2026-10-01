// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

for (const [era, options] of [['2025 compatibility', {}], ['2026-07-28', { versionNegotiation: { pin: '2026-07-28' } }]]) {
    test(`stdio: ${era} discovery, tools, resources, prompts and printing`, async t => {
        const state = mkdtempSync(join(tmpdir(), 'xprinter-protocol-'));
        const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('test/stdio-fixture.mjs')], env: { ...process.env, XPRINTER_STATE_DIR: state }, stderr: 'pipe' });
        let errors = ''; transport.stderr.on('data', chunk => { errors += chunk; });
        const client = new Client({ name: 'test-client', version: '1.0.0' }, options);
        t.after(async () => { await client.close(); rmSync(state, { recursive: true, force: true }); });
        await client.connect(transport);
        const tools = await client.listTools();
        assert.equal(tools.tools.length, 8);
        assert.equal(tools.tools.find(t => t.name === 'print_labels').annotations.destructiveHint, true);
        const prepared = await client.callTool({ name: 'prepare_labels', arguments: { labels: [{ kind: 'qr', code: '中文测试-123' }] } });
        assert.equal(prepared.isError, undefined); assert.equal(prepared.content[1].type, 'image');
        const { artifactId } = prepared.structuredContent;
        const resource = await client.readResource({ uri: `xprinter://labels/${artifactId}` });
        assert.equal(resource.contents[0].mimeType, 'application/pdf');
        assert.equal((await client.listPrompts()).prompts[0].name, 'label_printing_workflow');
        const key = randomUUID();
        const first = await client.callTool({ name: 'print_labels', arguments: { artifactId, confirmed: true, idempotencyKey: key } });
        const retry = await client.callTool({ name: 'print_labels', arguments: { artifactId, confirmed: true, idempotencyKey: key } });
        assert.equal(first.structuredContent.state, 'submitted'); assert.equal(retry.structuredContent.replayed, true);
        assert.equal(first.structuredContent.jobId, retry.structuredContent.jobId);
        assert.ok(!errors.includes('中文测试-123'), 'stderr must omit label contents');
    });
}
test('MCP tool metadata available in English, Russian and Simplified Chinese', async t => {
    for (const [language, expected] of [['en', 'Prepare labels'], ['ru', 'Подготовить этикетки'], ['zh-Hans', '准备标签']]) {
        const state = mkdtempSync(join(tmpdir(), 'xprinter-language-'));
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('test/stdio-fixture.mjs')], env: { ...process.env, XPRINTER_STATE_DIR: state, XPRINTER_LANGUAGE: language }, stderr: 'pipe' });
        try { await client.connect(transport); assert.equal((await client.listTools()).tools.find(t => t.name === 'prepare_labels').title, expected); }
        finally { await client.close(); rmSync(state, { recursive: true, force: true }); }
    }
});
