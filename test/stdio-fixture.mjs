// SPDX-License-Identifier: MIT
// Included only in the source repository, never in the downloadable runtime package.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from '../dist/server.js';
import { fixture, principal } from './helpers.mjs';
const f = fixture(null, { stateDir: process.env.XPRINTER_STATE_DIR, language: process.env.XPRINTER_LANGUAGE ?? 'en' });
const handle = serveStdio(() => createServer(f.service, principal));
process.once('SIGTERM', async () => { await handle.close(); f.store.close(); process.exit(0); });
process.stdin.once('end', async () => { await handle.close(); f.store.close(); process.exit(0); });
