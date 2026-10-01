// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../dist/config.js';
import { checkSshFiles, loadSshConfig, shellQuote, sshCommand } from '../dist/ssh.js';
import { CupsPrinter } from '../dist/native.js';
import { Store } from '../dist/store.js';
import { fixture, profile } from './helpers.mjs';

const sshEnv = { XPRINTER_BACKEND: 'ssh', XPRINTER_SSH_HOST: 'printer.example', XPRINTER_SSH_USER: 'printer',
    XPRINTER_SSH_KEY: resolve('private key'), XPRINTER_SSH_KNOWN_HOSTS: resolve('known hosts') };
test('SSH operator configuration rejects option/command injection and root login', () => {
    assert.equal(loadConfig(sshEnv).backend, 'ssh');
    assert.equal(loadConfig(sshEnv).allowPrint, false);
    assert.equal(loadSshConfig(sshEnv).port, 22);
    for (const value of ['host.docker.internal', '192.0.2.1', '2001:db8::1']) assert.equal(loadSshConfig({ ...sshEnv, XPRINTER_SSH_HOST: value }).host, value);
    for (const invalid of [
        { XPRINTER_SSH_HOST: '-oProxyCommand=bad' }, { XPRINTER_SSH_HOST: 'bad; touch file' },
        { XPRINTER_SSH_HOST: 'user@host' }, { XPRINTER_SSH_USER: 'root' }, { XPRINTER_SSH_USER: 'x\nroot' },
        { XPRINTER_SSH_PORT: '0' }, { XPRINTER_SSH_PORT: '65536' }, { XPRINTER_SSH_KEY: 'relative' },
    ]) assert.throws(() => loadSshConfig({ ...sshEnv, ...invalid }));
    assert.throws(() => loadConfig({ ...sshEnv, XPRINTER_RENDERER: '/app\0other' }));
});
test('SSH command has strict host authentication, no agent/TTY/forwards/retries and byte-exact stdin', async () => {
    const config = loadSshConfig(sshEnv), calls = [];
    const runner = sshCommand(config, async (...args) => { calls.push(args); return Buffer.from('ok'); });
    const input = Buffer.from([0, 255, 10, 39, 36]);
    assert.equal((await runner('/Applications/Open Xprinter.app/Contents/MacOS/OpenXprinter', ['--mcp-render'], input, 1234, 5678, true)).toString(), 'ok');
    assert.equal(calls.length, 1);
    const [executable, args, forwarded, limit, timeout, failureOutput] = calls[0];
    assert.equal(executable, config.executable); assert.equal(forwarded, input);
    assert.equal(limit, 1234); assert.equal(timeout, 5678); assert.equal(failureOutput, true);
    for (const option of ['StrictHostKeyChecking=yes', 'BatchMode=yes', 'IdentityAgent=none', 'ClearAllForwardings=yes', 'ConnectionAttempts=1', 'RequestTTY=no']) assert.ok(args.includes(option));
    assert.ok(args.includes(`UserKnownHostsFile="${config.knownHosts.replaceAll('\\', '\\\\')}"`));
    assert.equal(args.at(-2), 'printer.example');
    assert.ok(args.at(-1).includes("'/Applications/Open Xprinter.app/Contents/MacOS/OpenXprinter'"));
    assert.ok(args.at(-1).includes("'CUPS_SERVER=/private/var/run/cupsd'"));
});
test('POSIX argument quoting preserves shell metacharacters as data', { skip: process.platform === 'win32' }, () => {
    const input = "spaces 'quotes' \"double\" $HOME $(false) `false`; | & \n中文";
    assert.equal(execFileSync('/bin/sh', ['-c', `printf '%s' ${shellQuote(input)}`], { encoding: 'utf8' }), input);
    assert.throws(() => shellQuote('bad\0argument'));
});
test('SSH files are private regular files and not writable by others', t => {
    const folder = mkdtempSync(join(tmpdir(), 'xprinter-ssh-files-'));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    const config = loadSshConfig({ ...sshEnv, XPRINTER_SSH_KEY: join(folder, 'key'), XPRINTER_SSH_KNOWN_HOSTS: join(folder, 'hosts') });
    writeFileSync(config.identityFile, 'test key', { mode: 0o600 }); writeFileSync(config.knownHosts, 'test hosts', { mode: 0o600 });
    checkSshFiles(config);
    if (process.platform !== 'win32') {
        chmodSync(config.identityFile, 0o644); assert.throws(() => checkSshFiles(config), /private key/);
        chmodSync(config.identityFile, 0o600); chmodSync(config.knownHosts, 0o666); assert.throws(() => checkSshFiles(config), /writable/);
        chmodSync(config.knownHosts, 0o600);
        symlinkSync(config.identityFile, join(folder, 'link'));
        assert.throws(() => checkSshFiles({ ...config, identityFile: join(folder, 'link') }), /regular/);
    }
});
test('CUPS backend streams PDF stdin and refuses submission when already cancelled', async () => {
    const calls = [], pdf = Buffer.from('%PDF-test\0\xff');
    const printer = new CupsPrinter(async (...args) => { calls.push(args); return Buffer.from('request id is XP330B_OpenSource-42 (1 file(s))\n'); }, 'printer');
    assert.equal(await printer.submit(pdf, profile, 1, 'test-id'), 42);
    assert.equal(calls[0][0], '/usr/bin/lp'); assert.equal(calls[0][1].at(-1), '-'); assert.equal(calls[0][2], pdf);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(printer.submit(pdf, profile, 1, 'test-id', controller.signal), /cancelled/);
    assert.equal(calls.length, 1);
});
test('state is bound to one backend and survives restart without accepting another printer', t => {
    const { store, dir } = fixture(t);
    store.bindBackend('printer-a'); store.bindBackend('printer-a');
    assert.throws(() => store.bindBackend('printer-b'), /another printer/);
    const reopened = new Store(dir);
    try { reopened.bindBackend('printer-a'); assert.throws(() => reopened.bindBackend('printer-b'), /another printer/); }
    finally { reopened.close(); }
});
