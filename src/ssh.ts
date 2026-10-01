// SPDX-License-Identifier: MIT
import { isIP } from 'node:net';
import { isAbsolute, join, resolve } from 'node:path';
import { lstatSync, readFileSync, accessSync, constants } from 'node:fs';
import { z } from 'zod';
import { PublicError } from './config.js';
import { command } from './native.js';
import type { CommandRunner } from './native.js';

export interface SshConfig { host: string; port: number; username: string; identityFile: string; knownHosts: string; executable: string }
const absolute = z.string().refine(v => isAbsolute(v) && !/[\0\r\n]/.test(v));
export function loadSshConfig(env: NodeJS.ProcessEnv = process.env): SshConfig {
    return z.object({
        host: z.string().max(253).refine(v => isIP(v) !== 0 || /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/.test(v)),
        port: z.coerce.number().int().min(1).max(65535),
        username: z.string().regex(/^[a-z_][a-z0-9._-]{0,63}$/i).refine(v => v.toLowerCase() !== 'root'),
        identityFile: absolute, knownHosts: absolute, executable: absolute,
    }).parse({ host: env.XPRINTER_SSH_HOST, port: env.XPRINTER_SSH_PORT ?? '22', username: env.XPRINTER_SSH_USER,
        identityFile: env.XPRINTER_SSH_KEY ?? '/run/secrets/id_ed25519', knownHosts: env.XPRINTER_SSH_KNOWN_HOSTS ?? '/run/secrets/known_hosts',
        executable: env.XPRINTER_SSH_EXECUTABLE ?? (process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/OpenSSH/ssh.exe') : '/usr/bin/ssh') });
}
export function checkSshFiles(config: SshConfig): void {
    for (const file of [config.identityFile, config.knownHosts]) {
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.size === 0 || stat.size > 1024 * 1024) throw new PublicError('ssh_credentials', 'SSH key and known_hosts must be regular nonempty files.');
        accessSync(file, constants.R_OK);
        if (process.platform !== 'win32' && (stat.mode & 0o022)) throw new PublicError('ssh_credentials', 'SSH credentials must not be writable by group or others.');
        if (file === config.identityFile && process.platform !== 'win32' && (stat.mode & 0o077)) throw new PublicError('ssh_credentials', 'Keep the dedicated SSH private key readable only by its owner (0600).');
    }
}
export function shellQuote(value: string): string {
    if (value.includes('\0')) throw new PublicError('ssh_command', 'An invalid printer argument was refused.');
    return `'${value.replaceAll("'", "'\\''")}'`;
}
export function sshCommand(config: SshConfig, run: CommandRunner = command): CommandRunner {
    // These arguments come from printer adapters/operator config, never from an MCP command tool.
    return (executable, args, input, limit, timeout, allowFailureOutput) => {
        const remote = ['exec', '/usr/bin/env', 'LC_ALL=C', 'LANG=C', 'CUPS_SERVER=/private/var/run/cupsd', 'CUPS_ENCRYPTION=IfRequested', executable, ...args].map(shellQuote).join(' ');
        const nullFile = process.platform === 'win32' ? 'NUL' : '/dev/null';
        const knownHosts = config.knownHosts.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
        return run(config.executable, ['-F', nullFile, '-T',
            '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile="${knownHosts}"`,
            '-o', `GlobalKnownHostsFile=${nullFile}`, '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
            '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'PreferredAuthentications=publickey',
            '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1',
            '-o', 'ClearAllForwardings=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'RequestTTY=no',
            '-i', config.identityFile, '-p', String(config.port), '-l', config.username, config.host, remote], input, limit, timeout, allowFailureOutput);
    };
}

export function requirePersistentContainerState(stateDir: string, allowPrint: boolean, env: NodeJS.ProcessEnv = process.env): void {
    if (env.XPRINTER_CONTAINER !== '1' || !allowPrint) return;
    stateDir = resolve(stateDir);
    // The image needs a named volume/bind mount, so --rm or recreation cannot discard retry receipts.
    const mountInfo = readFileSync('/proc/self/mountinfo', 'utf8');
    const mounts = mountInfo.split('\n').map(line => line.split(' ')[4]);
    const decoded = mounts.filter((v): v is string => Boolean(v)).map(v => v.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8))));
    if (!decoded.some(v => v !== '/' && (stateDir === v || stateDir.startsWith(`${v}/`)))) {
        throw new PublicError('persistent_state_required', 'Mount a persistent volume at XPRINTER_STATE_DIR before enabling Docker printing.');
    }
    // tmpfs disappears with the container and cannot preserve retry receipts.
    if (mountInfo.split('\n').some(line => {
        const point = line.split(' ')[4]?.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
        return point && (stateDir === point || stateDir.startsWith(`${point}/`)) && / - (tmpfs|ramfs) /.test(line);
    })) throw new PublicError('persistent_state_required', 'Use a persistent volume for Docker print receipts, not tmpfs.');
}
