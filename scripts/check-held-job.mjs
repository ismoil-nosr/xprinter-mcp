// SPDX-License-Identifier: MIT
// Explicit operator check: creates one HELD job, verifies identity, then cancels it.
// It is never run by npm test/CI and does not issue a physical print request.
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { CupsPrinter, NativeRenderer, command, printArguments } from '../dist/native.js';
import { loadConfig } from '../dist/config.js';

assert.equal(process.argv[2], '--held-job', 'Explicit --held-job required.');
assert.equal(process.platform, 'darwin');
const native = new NativeRenderer(loadConfig());
const printer = new CupsPrinter();
const status = await printer.status();
assert.ok(status.configured && status.enabled && status.acceptingJobs);
const rendered = await native.render({ widthMm: 58, heightMm: 40, labels: [{ kind: 'qr', title: 'MCP held check', code: 'OPEN-XPRINTER-MCP', quantity: 1 }] });
const folder = await mkdtemp(join(tmpdir(), 'xprinter-held-check-'));
try {
    const file = join(folder, 'check.pdf'), jobId = randomUUID();
    await writeFile(file, rendered.pdf, { mode: 0o600, flag: 'wx' });
    const args = printArguments({ widthMm: 58, heightMm: 40, stock: 'gap', gapMm: 2, darkness: 7 }, 1, jobId, file);
    args.splice(args.length - 1, 0, '-H', 'hold');
    const receipt = (await command('/usr/bin/lp', args)).toString();
    const match = /^request id is XP330B_OpenSource-(\d+)\b/.exec(receipt);
    assert.ok(match, 'CUPS receipt required');
    const job = { jobId, cupsJobId: Number(match[1]) };
    assert.equal(await printer.jobState(job), 'held', 'Refuse a check that is not held');
    await printer.cancel(job);
    assert.equal(await printer.jobState(job), 'cancelled');
    console.log(JSON.stringify({ cupsHeldJob: 'verified', cancellation: 'verified', cupsJobId: job.cupsJobId, paperMovementRequested: false }));
} finally { await rm(folder, { recursive: true, force: true }); }
