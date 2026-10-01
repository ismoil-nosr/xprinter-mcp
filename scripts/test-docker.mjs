// SPDX-License-Identifier: MIT
// Real Docker + SSH transport; synthetic printer only. Run after building the production image.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const image = process.env.XPRINTER_TEST_IMAGE ?? 'xprinter-mcp:docker-test';
const suffix = randomUUID().slice(0, 8), prefix = `xprinter-check-${suffix}`;
const network = `${prefix}-network`, fixtureName = `${prefix}-mac`, volume = `${prefix}-state`;
const credentials = `${prefix}-credentials`;
const fixtureImage = `${prefix}-fixture`, directory = mkdtempSync(join(tmpdir(), 'xprinter-docker-'));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const key = join(directory, 'key'), hosts = join(directory, 'known_hosts');
const publicKey = join(directory, 'key.pub');
const base = ['run', '--rm', '-i', '--init', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=512m',
    '--network', network, '--mount', `type=volume,source=${volume},target=/var/lib/xprinter`,
    '--mount', `type=volume,source=${credentials},target=/run/secrets,readonly`,
    '-e', 'XPRINTER_SSH_HOST=printer-mac', '-e', 'XPRINTER_SSH_PORT=2222', '-e', 'XPRINTER_SSH_USER=printer', '-e', 'XPRINTER_ALLOW_PRINT=1'];
let client;
function initializeCredentials() {
    docker('run', '--rm', '--user', '0:0', '--cap-drop=ALL', '--cap-add=CHOWN', '--cap-add=DAC_OVERRIDE', '--security-opt=no-new-privileges',
        '--mount', `type=volume,source=${credentials},target=/credentials`,
        '--mount', `type=bind,source=${key},target=/input/key,readonly`, '--mount', `type=bind,source=${hosts},target=/input/hosts,readonly`,
        '--entrypoint', 'sh', image, '-ec', 'umask 077; chown -R 0:0 /credentials; chmod 700 /credentials; cp /input/key /credentials/id_ed25519; cp /input/hosts /credentials/known_hosts; chmod 600 /credentials/*; chown -R 1000:1000 /credentials');
}
async function connect(options = {}) {
    client = new Client({ name: 'container-test', version: '1.0.0' }, options);
    const transport = new StdioClientTransport({ command: 'docker', args: [...base, image, 'stdio'], env: process.env, stderr: 'pipe' });
    // Consume Docker/OpenSSH diagnostics privately; test output contains assertions only.
    let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk.toString(); });
    try { await client.connect(transport); } catch (error) { throw new Error(`Container connection failed: ${stderr.slice(0, 1000)}`, { cause: error }); }
    return client;
}
const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, `Tool failed: ${name}`); return result.structuredContent;
};
const httpRequest = (address, path, method = 'GET') => new Promise((resolve, reject) => {
    const req = request(`http://${address}${path}`, { method, headers: { Host: 'printer.example', 'Content-Type': 'application/json' }, timeout: 2000 }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('HTTP check timed out.')));
    req.end(method === 'POST' ? '{}' : undefined);
});
try {
    const manifest = JSON.parse(readFileSync('package.json'));
    assert.equal(docker('run', '--rm', image, '--version'), manifest.version);
    assert.ok(docker('run', '--rm', image, '--help').includes('XPRINTER_BACKEND=ssh'));
    const metadata = JSON.parse(docker('image', 'inspect', image));
    assert.equal(metadata[0].Config.User, 'node');
    assert.equal(metadata[0].Config.Labels['org.opencontainers.image.source'], 'https://github.com/ismoil-nosr/xprinter-mcp');
    assert.equal(docker('run', '--rm', '--entrypoint', 'node', image, '-e', "const f=require('fs');if(f.existsSync('/app/test')||f.existsSync('/app/src')||f.existsSync('/root/.ssh'))process.exit(1);console.log('clean')"), 'clean');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { stdio: 'pipe' });
    docker('build', '--tag', fixtureImage, '--file', resolve('test/docker/sshd.Dockerfile'), resolve('test/docker'));
    docker('network', 'create', network);
    docker('volume', 'create', volume);
    docker('volume', 'create', credentials);
    docker('run', '--detach', '--name', fixtureName, '--network', network, '--network-alias', 'printer-mac',
        '--mount', `type=bind,source=${publicKey},target=/fixture/authorized_keys,readonly`, fixtureImage);
    const hostKey = docker('exec', fixtureName, 'cat', '/etc/ssh/ssh_host_ed25519_key.pub').split(' ').slice(0, 2).join(' ');
    writeFileSync(hosts, `[printer-mac]:2222 ${hostKey}\n`, { mode: 0o600 });
    initializeCredentials();
    // The image must refuse loss of durable receipts and must never print in this case.
    const noVolume = [...base]; noVolume.splice(noVolume.indexOf(`type=volume,source=${volume},target=/var/lib/xprinter`) - 1, 2);
    const refused = spawnSync('docker', [...noVolume, image, 'stdio'], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(refused.status, 1); assert.ok(refused.stderr.includes('persistent_state_required'));
    for (const options of [{}, { versionNegotiation: { pin: '2026-07-28' } }]) {
        await connect(options);
        assert.equal((await client.listTools()).tools.length, 8);
        assert.equal((await call('printer_status')).configured, true);
        const prepared = await call('prepare_labels', { labels: [{ kind: 'qr', code: '中文 · Товар', quantity: 1 }] });
        assert.equal(prepared.pages, 1);
        const resource = await client.readResource({ uri: `xprinter://labels/${prepared.artifactId}` });
        assert.equal(resource.contents[0].mimeType, 'application/pdf');
        const intent = { artifactId: prepared.artifactId, confirmed: true, idempotencyKey: randomUUID() };
        const receipt = await call('print_labels', intent);
        assert.equal(receipt.state, 'submitted');
        await client.close(); client = undefined;
        await connect(options);
        const replay = await call('print_labels', intent);
        assert.equal(replay.replayed, true); assert.equal(replay.jobId, receipt.jobId);
        assert.equal((await call('job_status', { jobId: receipt.jobId })).spoolerState, 'pending');
        assert.equal((await call('cancel_job', { jobId: receipt.jobId })).state, 'cancelled');
        await client.close(); client = undefined;
    }
    await connect({ versionNegotiation: { pin: '2026-07-28' } });
    const prepared = await call('prepare_labels', { labels: [{ kind: 'text', code: 'Lost SSH receipt' }] });
    docker('exec', fixtureName, 'touch', '/fixture-state/drop-next-receipt');
    const intent = { artifactId: prepared.artifactId, confirmed: true, idempotencyKey: randomUUID() };
    const uncertain = await call('print_labels', intent); assert.equal(uncertain.state, 'uncertain');
    await client.close(); client = undefined;
    await connect();
    assert.equal((await call('print_labels', intent)).jobId, uncertain.jobId);
    assert.equal(JSON.parse(docker('exec', fixtureName, 'cat', '/fixture-state/jobs.json')).length, 3, 'No duplicate dispatch across container recreation or lost response');
    await client.close(); client = undefined;
    const changed = spawnSync('docker', [...base, '-e', 'XPRINTER_SSH_HOST=another-printer', image, 'doctor'], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(changed.status, 1); assert.ok(changed.stderr.includes('backend_changed'));
    writeFileSync(hosts, '[printer-mac]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIInvalidUntrustedKey\n');
    initializeCredentials();
    const untrusted = spawnSync('docker', [...base, image, 'doctor'], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(untrusted.status, 1); assert.equal(JSON.parse(untrusted.stdout).configured, false);
    assert.equal(JSON.parse(docker('exec', fixtureName, 'cat', '/fixture-state/jobs.json')).length, 3);
    // HTTP starts in the image only with OAuth metadata configured; no anonymous MCP is accepted.
    const httpName = `${prefix}-http`;
    try {
        docker('run', '--detach', '--name', httpName, ...base.slice(2).filter(v => v !== '-i'),
            '--publish', '127.0.0.1::8787', '-e', 'XPRINTER_LISTEN_HOST=0.0.0.0',
            '-e', 'XPRINTER_PUBLIC_URL=https://printer.example/mcp', '-e', 'XPRINTER_OAUTH_ISSUER=https://identity.example',
            '-e', 'XPRINTER_OAUTH_JWKS_URL=https://identity.example/jwks', image, 'http');
        const address = docker('port', httpName, '8787/tcp');
        let ready;
        for (let attempt = 0; attempt < 40; attempt++) {
            try { ready = await httpRequest(address, '/.well-known/oauth-protected-resource/mcp'); break; }
            catch { await new Promise(resolve => setTimeout(resolve, 100)); }
        }
        assert.equal(ready?.status, 200, ready?.body);
        const response = await httpRequest(address, '/mcp', 'POST');
        assert.equal(response.status, 401); assert.ok(response.headers['www-authenticate'].includes('oauth-protected-resource'));
    } finally { try { docker('rm', '--force', httpName); } catch {} }
    console.log(JSON.stringify({ image, nonRoot: true, readOnly: true, protocolEras: ['2025 compatibility', '2026-07-28'], sshTransport: 'passed',
        durableContainerRecreation: 'passed', lostReceiptNoReplay: 'passed', hostKeyRejection: 'passed', noVolumeRejection: 'passed', httpOAuthRequired: 'passed', realPrinterAccess: false }));
} finally {
    if (client) await client.close();
    for (const args of [['rm', '--force', fixtureName], ['network', 'rm', network], ['volume', 'rm', volume], ['volume', 'rm', credentials], ['image', 'rm', fixtureImage]]) {
        try { docker(...args); } catch { /* only this test's UUID-scoped disposable resources */ }
    }
    rmSync(directory, { recursive: true, force: true });
}
