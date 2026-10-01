// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../dist/store.js';
import { prepareLabelsSchema, preparePdfSchema, printSchema } from '../dist/schema.js';
import { printArguments, verifyJobIdentity } from '../dist/native.js';
import { fixture, principal, other, profile, prepare } from './helpers.mjs';

test('strict input, geometry, Unicode and batch limits', () => {
    const valid = prepareLabelsSchema.parse({ labels: [{ kind: 'qr', code: '中文测试-123' }] });
    assert.equal(valid.profile.widthMm, 58);
    for (const input of [
        { labels: [{ kind: 'code128', code: '中文' }] },
        { labels: [{ kind: 'qr', code: '中'.repeat(300) }] },
        { labels: [{ kind: 'text', code: 'x', quantity: 101 }] },
        { labels: [{ kind: 'qr', code: 'x', quantity: 60 }, { kind: 'qr', code: 'x', quantity: 60 }] },
        { profile: { widthMm: 80 }, labels: [{ kind: 'qr', code: 'x' }] },
        { profile: { stock: 'gap', gapMm: 0 }, labels: [{ kind: 'qr', code: 'x' }] },
        { labels: [{ kind: 'qr', code: 'x' }], file: '/etc/passwd' },
    ]) assert.equal(prepareLabelsSchema.safeParse(input).success, false);
    assert.equal(preparePdfSchema.safeParse({ pdfBase64: 'file:///etc/passwd' }).success, false);
    assert.equal(printSchema.safeParse({ artifactId: randomUUID(), idempotencyKey: randomUUID(), confirmed: false }).success, false);
});
test('physical stock and argument arrays match native driver', () => {
    const args = printArguments(profile, 2, randomUUID(), '/tmp/private/labels.pdf');
    assert.ok(args.includes('PageSize=40x58mmRotated.Fullbleed'));
    assert.ok(args.includes('GapsHeight=2'));
    assert.ok(args.includes('fit-to-page=false'));
    assert.equal(args.at(-1), '/tmp/private/labels.pdf');
    assert.ok(printArguments({ ...profile, widthMm: 35.5, stock: 'continuous' }, 1, randomUUID(), '/tmp/file.pdf').includes('PageSize=Custom.35.5x40mm'));
    assert.ok(printArguments({ ...profile, stock: 'continuous' }, 1, randomUUID(), '/tmp/file.pdf').includes('GapsHeight=0'));
});
test('CUPS identity rejects reused job numbers, foreign queues and missing/private attributes', () => {
    const job = { jobId: randomUUID(), cupsJobId: 42 };
    const attrs = { 'job-id': 42, 'job-name': `Open Xprinter MCP ${job.jobId}`, 'job-printer-uri': 'ipp://localhost:631/printers/XP330B_OpenSource', 'job-state': 4 };
    assert.equal(verifyJobIdentity(attrs, job).state, 4);
    for (const bad of [
        { 'job-id': 41 }, { 'job-name': `Open Xprinter MCP ${randomUUID()}` }, { 'job-name': undefined },
        { 'job-printer-uri': 'ipp://localhost/printers/Canon' },
        { 'job-printer-uri': 'ipp://attacker.example.com/printers/XP330B_OpenSource' },
    ]) assert.throws(() => verifyJobIdentity({ ...attrs, ...bad }, job));
});
test('preparation and preview never call the printer', async t => {
    const { service, printer } = fixture(t);
    const artifact = await prepare(service);
    assert.equal(service.preview(principal, artifact.artifactId).pages, 1);
    assert.equal(printer.submissions.length, 0);
    assert.equal(printer.cancelled.length, 0);
});
test('scope and owner isolation cover artifacts, printing, status and cancellation', async t => {
    const { service, printer } = fixture(t);
    const artifact = await prepare(service);
    assert.throws(() => service.preview(other, artifact.artifactId), /unavailable/);
    await assert.rejects(service.print(other, artifact.artifactId, 1, randomUUID()), /unavailable/);
    await assert.rejects(prepare(service, { owner: 'alice', scopes: ['xprinter.read'] }), /scope/);
    await assert.rejects(service.print({ owner: 'alice', scopes: ['xprinter.read'] }, artifact.artifactId, 1, randomUUID()), /scope/);
    const job = await service.print(principal, artifact.artifactId, 1, randomUUID());
    await assert.rejects(service.jobStatus(other, job.jobId), /unavailable/);
    await assert.rejects(service.cancel(other, job.jobId), /unavailable/);
    assert.equal(printer.cancelled.length, 0);
});
test('printing disabled by operator even for a print-scoped identity', async t => {
    const { service, printer } = fixture(t, { allowPrint: false });
    const artifact = await prepare(service);
    await assert.rejects(service.print(principal, artifact.artifactId, 1, randomUUID()), /ALLOW_PRINT/);
    assert.equal(printer.submissions.length, 0);
});
test('concurrent retries dispatch once and conflicting input is rejected', async t => {
    const { service, printer } = fixture(t);
    const artifact = await prepare(service), key = randomUUID();
    const [a, b] = await Promise.all([service.print(principal, artifact.artifactId, 2, key), service.print(principal, artifact.artifactId, 2, key)]);
    assert.equal(a.jobId, b.jobId); assert.equal(printer.submissions.length, 1);
    const replay = await service.print(principal, artifact.artifactId, 2, key);
    assert.equal(replay.replayed, true); assert.equal(replay.state, 'submitted');
    await assert.rejects(service.print(principal, artifact.artifactId, 1, key), /different print request/);
});
test('lost CUPS response retains uncertain receipt and never auto-reprints', async t => {
    const { service, printer } = fixture(t);
    printer.fail = true;
    const artifact = await prepare(service), key = randomUUID();
    const first = await service.print(principal, artifact.artifactId, 1, key);
    assert.equal(first.state, 'uncertain'); assert.equal(first.cupsJobId, null);
    const retry = await service.print(principal, artifact.artifactId, 1, key);
    assert.equal(retry.jobId, first.jobId); assert.equal(printer.submissions.length, 1);
    assert.equal((await service.jobStatus(principal, first.jobId)).physicalOutputVerified, false);
});
test('durable reservation survives another process/store and restart', async t => {
    const { store, service, dir } = fixture(t);
    const artifact = await prepare(service), key = randomUUID();
    const first = store.reserve(principal.owner, key, artifact.artifactId, 1, 100, 500);
    const second = new Store(dir);
    try {
        const replay = second.reserve(principal.owner, key, artifact.artifactId, 1, 100, 500);
        assert.equal(replay.dispatch, false); assert.equal(replay.job.jobId, first.job.jobId);
        assert.equal(replay.job.state, 'uncertain');
    } finally { second.close(); }
});
test('global hourly budget and per-job copies include uncertain jobs', async t => {
    const { service, printer } = fixture(t, { maxLabelsPerJob: 3, maxLabelsPerHour: 4 });
    const artifact = await prepare(service, principal, 2);
    await assert.rejects(service.print(principal, artifact.artifactId, 2, randomUUID()), /At most 3/);
    printer.fail = true;
    await service.print(principal, artifact.artifactId, 1, randomUUID());
    const theirs = await prepare(service, other, 2);
    await service.print(other, theirs.artifactId, 1, randomUUID());
    await assert.rejects(service.print(principal, artifact.artifactId, 1, randomUUID()), /hourly/);
    assert.equal(printer.submissions.length, 2);
});
test('expiry denies new printing but retry still returns its durable receipt', async t => {
    let now = Date.now();
    const { service, printer } = fixture(t, { now: () => now });
    const artifact = await prepare(service), key = randomUUID();
    const job = await service.print(principal, artifact.artifactId, 1, key);
    now += 16 * 60_000;
    assert.throws(() => service.preview(principal, artifact.artifactId), /expired/);
    const retry = await service.print(principal, artifact.artifactId, 1, key);
    assert.equal(retry.jobId, job.jobId);
    await assert.rejects(service.print(principal, artifact.artifactId, 1, randomUUID()), /expired/);
    assert.equal(printer.submissions.length, 1);
});
test('private database permissions on POSIX and bounded preview storage', async t => {
    const { store, dir } = fixture(t);
    if (process.platform !== 'win32') {
        assert.equal(lstatSync(dir).mode & 0o777, 0o700);
        assert.equal(lstatSync(join(dir, 'state.sqlite')).mode & 0o777, 0o600);
    }
    assert.throws(() => store.put('alice', profile, { pdf: Buffer.alloc(65 * 1024 * 1024), preview: Buffer.alloc(0), pages: 1 }), /storage is full/);
});
test('cancellation is scoped, durable and repeatable', async t => {
    const { service, printer } = fixture(t);
    const artifact = await prepare(service), job = await service.print(principal, artifact.artifactId, 1, randomUUID());
    assert.equal((await service.cancel(principal, job.jobId)).state, 'cancelled');
    assert.equal((await service.cancel(principal, job.jobId)).state, 'cancelled');
    assert.equal(printer.cancelled.length, 1);
});
