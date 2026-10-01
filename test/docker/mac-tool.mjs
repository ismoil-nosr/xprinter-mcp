#!/usr/local/bin/node
// SPDX-License-Identifier: MIT
// Synthetic macOS commands inside an isolated SSH fixture, with no access to any real printer.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { basename } from 'node:path';
const tool = basename(process.argv[1]), args = process.argv.slice(2);
const file = '/fixture-state/jobs.json';
const jobs = existsSync(file) ? JSON.parse(readFileSync(file)) : [];
const save = () => writeFileSync(file, JSON.stringify(jobs));
if (tool === 'lpstat') {
    if (args[0] === '-v') console.log('device for XP330B_OpenSource: usb://Xprinter/XP-330B?fixture=1');
    else if (args[0] === '-p') console.log('printer XP330B_OpenSource is idle. enabled since fixture');
    else if (args[0] === '-a') console.log('XP330B_OpenSource accepting requests since fixture');
} else if (tool === 'lpoptions') {
    console.log('Resolution/Resolution: *203dpi\nPageSize/Page Size: *40x58mmRotated.Fullbleed');
} else if (tool === 'OpenXprinter') {
    const request = JSON.parse(readFileSync(0, 'utf8'));
    const pages = request.labels?.reduce((n, label) => n + label.quantity, 0) ?? 1;
    console.log(JSON.stringify({ widthMm: request.widthMm, heightMm: request.heightMm, pages,
        pdfBase64: Buffer.from('%PDF-1.4\nSynthetic SSH fixture only').toString('base64'),
        previewBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5iUAAAAASUVORK5CYII=' }));
} else if (tool === 'plutil') {
    if (args[0] === '-extract') console.log('0.3.0');
    else process.stdout.write(readFileSync(0));
} else if (tool === 'lp') {
    const pdf = readFileSync(0);
    if (args.at(-1) !== '-' || pdf.subarray(0, 5).toString() !== '%PDF-') process.exit(2);
    const job = { id: 40 + jobs.length, name: args[args.indexOf('-t') + 1], state: 3 };
    jobs.push(job); save();
    if (existsSync('/fixture-state/drop-next-receipt')) { unlinkSync('/fixture-state/drop-next-receipt'); process.exit(1); }
    console.log(`request id is XP330B_OpenSource-${job.id} (1 file(s))`);
} else if (tool === 'ipptool') {
    readFileSync(0);
    const id = Number(args.find(v => v.startsWith('job-id=')).slice(7));
    const job = jobs.find(v => v.id === id);
    if (!job) process.exit(1);
    console.log(JSON.stringify({ Successful: true, Tests: [{ ResponseAttributes: [{ 'job-id': id, 'job-name': job.name,
        'job-printer-uri': 'ipp://127.0.0.1:631/printers/XP330B_OpenSource', 'job-state': job.state }] }] }));
} else if (tool === 'cancel') {
    const job = jobs.find(v => v.id === Number(args[0].split('-').at(-1)));
    if (!job) process.exit(1);
    job.state = 7; save();
} else process.exit(2);
