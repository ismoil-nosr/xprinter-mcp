// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { NativeRenderer } from '../dist/native.js';

const renderer = process.env.XPRINTER_RENDERER;
test('real native renderer handles Unicode, physical size and PDF import without paper movement', { skip: !renderer || process.platform !== 'darwin' }, async () => {
    const native = new NativeRenderer({ renderer });
    const result = await native.render({ widthMm: 58, heightMm: 40, labels: [{ kind: 'qr', title: '商品 · Товар', code: '中文测试-123', quantity: 2 }] });
    assert.equal(result.pages, 2); assert.ok(result.pdf.length > 1000); assert.ok(result.preview.length > 1000);
    const fitted = await native.render({ widthMm: 58, heightMm: 40, pdfBase64: result.pdf.toString('base64') });
    assert.equal(fitted.pages, 2);
    await assert.rejects(native.render({ widthMm: 100, heightMm: 40, labels: [] }));
});
test('actual packaged CLI serves both MCP eras and native previews', { skip: !renderer || process.platform !== 'darwin' }, async () => {
    for (const options of [{}, { versionNegotiation: { pin: '2026-07-28' } }]) {
        const directory = mkdtempSync(join(tmpdir(), 'xprinter-native-cli-'));
        const client = new Client({ name: 'native-test', version: '1.0.0' }, options);
        const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'stdio'], env: { ...process.env, XPRINTER_RENDERER: renderer, XPRINTER_STATE_DIR: directory, XPRINTER_ALLOW_PRINT: '0' }, stderr: 'pipe' });
        try {
            await client.connect(transport);
            const result = await client.callTool({ name: 'prepare_labels', arguments: { labels: [{ kind: 'qr', code: '中文测试-123', title: '商品' }] } });
            assert.equal(result.isError, undefined); assert.equal(result.structuredContent.pages, 1);
            assert.equal(result.content[1].mimeType, 'image/png');
            const capabilities = await client.callTool({ name: 'printer_capabilities', arguments: {} });
            assert.equal(capabilities.structuredContent.printEnabled, false);
        } finally { await client.close(); rmSync(directory, { recursive: true, force: true }); }
    }
});
