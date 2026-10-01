#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { loadConfig, PublicError, SCOPES, VERSION } from './config.js';
import { loadHttpConfig } from './auth.js';
import { httpServer } from './http.js';
import { command, CupsPrinter, NativeRenderer } from './native.js';
import { checkSshFiles, loadSshConfig, requirePersistentContainerState, sshCommand } from './ssh.js';
import { Store } from './store.js';
import { PrinterService } from './service.js';
import { createServer } from './server.js';

process.umask(0o077);
const args = process.argv.slice(2);
const mode = args[0] ?? 'stdio';
if (args.length > 1 || !['stdio', 'http', 'doctor', 'config', '--help', '--version'].includes(mode)) {
    process.stderr.write('Usage: xprinter-mcp [stdio|http|doctor|config|--help|--version]\n'); process.exit(2);
}
if (mode === '--version') { process.stdout.write(`${VERSION}\n`); process.exit(0); }
if (mode === '--help') {
    process.stdout.write('Open Xprinter MCP\nUsage: xprinter-mcp [stdio|http|doctor|config]\nDefault: stdio; physical printing disabled.\nBackends: local macOS, or XPRINTER_BACKEND=ssh from Docker/Windows/Linux/macOS to the printer Mac.\nSSH requires XPRINTER_SSH_HOST, XPRINTER_SSH_USER, a private key and verified known_hosts.\nconfig prints native local client JSON with absolute paths; Docker client templates are in examples.\nSet XPRINTER_ALLOW_PRINT=1 after checking the loaded stock. Docker printing needs a persistent state volume.\nHTTP requires XPRINTER_PUBLIC_URL, XPRINTER_OAUTH_ISSUER and XPRINTER_OAUTH_JWKS_URL (HTTPS).\nDocumentation: https://github.com/ismoil-nosr/xprinter-mcp\n'); process.exit(0);
}
try {
    const config = loadConfig();
    if (config.backend === 'local' && process.platform !== 'darwin') throw new Error('The local USB backend requires macOS. Use XPRINTER_BACKEND=ssh for a remote printer Mac.');
    if (mode === 'config') {
        if (config.backend !== 'local') throw new Error('Use examples/docker.json for a Docker client, or preserve the SSH environment in a native client configuration.');
        process.stdout.write(JSON.stringify({ mcpServers: { xprinter: { command: process.execPath, args: [process.argv[1], 'stdio'], env: { XPRINTER_ALLOW_PRINT: config.allowPrint ? '1' : '0', XPRINTER_LANGUAGE: config.language } } } }, null, 2) + '\n'); process.exit(0);
    }
    const httpConfig = mode === 'http' ? loadHttpConfig() : undefined;
    const ssh = config.backend === 'ssh' ? loadSshConfig() : undefined;
    if (ssh) checkSshFiles(ssh);
    requirePersistentContainerState(config.stateDir, config.allowPrint);
    const run = ssh ? sshCommand(ssh) : command;
    const store = new Store(config.stateDir);
    store.bindBackend(JSON.stringify(ssh ? ['ssh', ssh.host.toLowerCase(), ssh.port, ssh.username] : ['local', userInfo().username]));
    const service = new PrinterService(config, store, new NativeRenderer(config, run), new CupsPrinter(run, ssh?.username));
    if (mode === 'doctor') {
        const status = await service.printer.status();
        let rendering = false;
        try { await service.renderer.render({ widthMm: 58, heightMm: 40, labels: [{ kind: 'qr', title: 'MCP test', code: 'OPEN-XPRINTER-MCP', footer: '', quantity: 1 }] }); rendering = true; } catch { /* doctor consumes no labels */ }
        process.stdout.write(JSON.stringify({ version: VERSION, backend: config.backend, ...status, rendering, printEnabled: config.allowPrint, physicalOutputVerified: false }, null, 2) + '\n');
        store.close(); process.exit(status.configured && rendering ? 0 : 1);
    }
    const cleanup = setInterval(() => { try { store.cleanup(); } catch { process.stderr.write('State cleanup deferred.\n'); } }, 60_000); cleanup.unref();
    let close: () => Promise<void>;
    if (mode === 'http' && httpConfig) {
        const serving = httpServer(service, httpConfig);
        const host = httpConfig.listenHost ?? '127.0.0.1';
        serving.server.listen(httpConfig.port, host, () => process.stderr.write(`Open Xprinter MCP listening on ${host}:${httpConfig.port}; publish through an HTTPS reverse proxy.\n`));
        serving.server.on('error', () => { process.stderr.write('HTTP listener failed. Check the configured port.\n'); process.exit(1); });
        close = () => serving.close();
    } else {
        const owner = createHash('sha256').update(`local:${userInfo().username}`).digest('hex');
        const serving = serveStdio(() => createServer(service, { owner, scopes: SCOPES }), { onerror: () => process.stderr.write('MCP request rejected.\n'), maxSubscriptions: 0 });
        close = () => serving.close();
    }
    let stopping = false;
    async function stop(): Promise<void> {
        if (stopping) return;
        stopping = true; clearInterval(cleanup);
        const force = setTimeout(() => process.exit(0), 10_000); force.unref();
        await close(); store.close(); process.exit(0);
    }
    process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
    if (mode === 'stdio') process.stdin.once('end', () => { void stop(); });
} catch (error) {
    // Avoid printing environment values, access tokens or Zod input values.
    if (error instanceof PublicError) process.stderr.write(`${error.code}: ${error.message}\n`);
    process.stderr.write('MCP startup failed. Check Node 24+, Open Xprinter 0.3.1+, backend/SSH configuration, credential permissions and persistent state volume. See --help.\n'); process.exit(1);
}
