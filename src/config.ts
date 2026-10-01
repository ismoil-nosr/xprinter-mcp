// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { isAbsolute, join, posix } from 'node:path';
import { z } from 'zod';

export const VERSION = '0.2.1';
export const QUEUE = 'XP330B_OpenSource';
export const BODY_LIMIT = 3 * 1024 * 1024;
export const SCOPES = ['xprinter.read', 'xprinter.prepare', 'xprinter.print', 'xprinter.cancel'] as const;
export type Scope = typeof SCOPES[number];
export interface Principal { owner: string; scopes: readonly string[] }
export class PublicError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
}
export interface Config {
    backend: 'local' | 'ssh';
    stateDir: string;
    renderer: string;
    allowPrint: boolean;
    maxLabelsPerJob: number;
    maxLabelsPerHour: number;
    language: 'en' | 'ru' | 'zh-Hans';
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const backend = env.XPRINTER_BACKEND ?? 'local';
    const raw = z.object({
        backend: z.enum(['local', 'ssh']),
        stateDir: z.string().refine(isAbsolute),
        renderer: z.string().refine(v => posix.isAbsolute(v) && !v.includes('\0') && !/[\r\n]/.test(v)),
        allowPrint: z.enum(['0', '1']).transform(v => v === '1'),
        maxLabelsPerJob: z.coerce.number().int().min(1).max(100),
        maxLabelsPerHour: z.coerce.number().int().min(1).max(1000),
        language: z.enum(['en', 'ru', 'zh-Hans']),
    }).parse({
        backend,
        stateDir: env.XPRINTER_STATE_DIR ?? (backend === 'ssh' ? join(homedir(), '.local/share/open-xprinter-mcp') : join(homedir(), 'Library/Application Support/Open Xprinter/MCP')),
        renderer: env.XPRINTER_RENDERER ?? '/Applications/Open Xprinter.app/Contents/MacOS/OpenXprinter',
        allowPrint: env.XPRINTER_ALLOW_PRINT ?? '0',
        maxLabelsPerJob: env.XPRINTER_MAX_LABELS_PER_JOB ?? '100',
        maxLabelsPerHour: env.XPRINTER_MAX_LABELS_PER_HOUR ?? '500',
        language: env.XPRINTER_LANGUAGE ?? 'en',
    });
    return raw;
}
export function requireScope(principal: Principal, scope: Scope): void {
    if (!principal.scopes.includes(scope)) throw new PublicError('forbidden', `Required scope: ${scope}.`);
}
