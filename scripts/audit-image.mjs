// SPDX-License-Identifier: MIT
// Maintainer/CI scanner only. It receives no Docker socket, SSH keys, labels or tokens.
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--input', '--image', '--platform'].includes(key) || !process.argv[i + 1] || options[key]) throw new Error('Use --input archive.tar OR --image registry/ref, with optional --platform linux/amd64|linux/arm64.');
    options[key] = process.argv[i + 1];
}
if (Boolean(options['--input']) === Boolean(options['--image'])) throw new Error('Choose exactly one image source.');
if (options['--platform'] && !['linux/amd64', 'linux/arm64'].includes(options['--platform'])) throw new Error('Unsupported platform.');
const scanner = readFileSync(new URL('../security/Dockerfile', import.meta.url), 'utf8').match(/^FROM (aquasec\/trivy:[0-9.]+@sha256:[a-f0-9]{64})$/m)?.[1];
if (!scanner) throw new Error('The scanner must have a version and SHA-256 digest pin.');
const folder = mkdtempSync(join(tmpdir(), 'xprinter-image-audit-'));
const cache = process.env.XPRINTER_TRIVY_CACHE ? resolve(process.env.XPRINTER_TRIVY_CACHE) : join(folder, 'cache');
mkdirSync(cache, { recursive: true, mode: 0o700 });
const output = join(folder, 'output'); mkdirSync(output, { mode: 0o700 });
try {
    const args = ['run', '--rm', '--read-only', '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=2g', '--cpus=2',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m', '--mount', `type=bind,source=${cache},target=/cache`,
        '--mount', `type=bind,source=${output},target=/output`];
    if (options['--input']) args.push('--mount', `type=bind,source=${resolve(options['--input'])},target=/image.tar,readonly`);
    args.push(scanner, 'image', '--cache-dir', '/cache', '--quiet', '--timeout', '5m', '--scanners', 'vuln,secret',
        '--format', 'json', '--output', '/output/scan.json');
    if (options['--platform']) args.push('--platform', options['--platform']);
    if (options['--input']) args.push('--input', '/image.tar');
    else args.push('--image-src', 'remote', options['--image']);
    const scan = spawnSync('docker', args, { encoding: 'utf8', timeout: 360_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    if (scan.error || scan.status !== 0) throw new Error('Container scan failed; no clean result is claimed. Check Docker, disk space and registry/database connectivity.');
    const report = JSON.parse(readFileSync(join(output, 'scan.json'), 'utf8'));
    const counts = {}, advisories = []; let secrets = 0;
    for (const result of report.Results ?? []) {
        secrets += (result.Secrets ?? []).length;
        for (const item of result.Vulnerabilities ?? []) {
            counts[item.Severity] = (counts[item.Severity] ?? 0) + 1;
            advisories.push({ id: item.VulnerabilityID, package: item.PkgName, installed: item.InstalledVersion, fixed: item.FixedVersion ?? null, severity: item.Severity });
        }
    }
    const blocked = secrets > 0 || (counts.HIGH ?? 0) > 0 || (counts.CRITICAL ?? 0) > 0;
    // Secret values, snippets and matched source are never printed or uploaded.
    console.log(JSON.stringify({ scanner, platform: options['--platform'] ?? 'archive platform', vulnerabilityCounts: counts, advisories, secretFindings: secrets, blocked }));
    if (blocked) process.exitCode = 1;
} finally {
    rmSync(folder, { recursive: true, force: true });
}
