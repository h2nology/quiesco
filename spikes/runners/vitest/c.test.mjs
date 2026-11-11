import fs from 'node:fs';
import { test } from 'vitest';
import { getSession } from './shared.mjs';
test('c', () => { const s = getSession(); fs.appendFileSync(process.env.SPIKE_LOG, `c pid=${process.pid} session=${s.id} created=${s.created}\n`); });
