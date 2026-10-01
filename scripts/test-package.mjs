// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const npm = process.env.npm_execpath;
assert.ok(npm, 'Run through npm run test:package.');
const report = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--json', '--ignore-scripts'], { encoding: 'utf8' }))[0];
const paths = report.files.map(f => f.path);
for (const required of ['dist/cli.js', 'npm-shrinkwrap.json', 'LICENSE', 'SECURITY.md', 'docs/README.ru.md', 'docs/README.zh-CN.md', 'examples/ssh.json']) assert.ok(paths.includes(required), `Archive missing ${required}`);
assert.ok(!paths.some(p => /^(test|src|node_modules|\.private)\//.test(p) || p.includes('.env') || p.includes('.sqlite')));
const manifest = JSON.parse(readFileSync('package.json'));
assert.equal(JSON.parse(readFileSync('npm-shrinkwrap.json')).version, manifest.version);
assert.ok(readFileSync('dist/cli.js', 'utf8').startsWith('#!/usr/bin/env node'));
const folder = mkdtempSync(join(tmpdir(), 'xprinter-package-test-'));
try {
    execFileSync(process.execPath, [npm, 'install', '--prefix', folder, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', resolve(report.filename)], { stdio: 'pipe' });
    const cli = join(folder, 'node_modules/@ismoil-nosr/xprinter-mcp/dist/cli.js');
    assert.equal(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), manifest.version);
    assert.ok(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).includes('XPRINTER_ALLOW_PRINT'));
    console.log(JSON.stringify({ archive: report.filename, archiveFiles: paths.length, cleanRuntimeInstall: 'passed', version: manifest.version }));
} finally { rmSync(folder, { recursive: true, force: true }); }
