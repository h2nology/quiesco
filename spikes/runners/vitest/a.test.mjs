import fs from 'node:fs';
import { test } from 'vitest';
import { getSession } from './shared.mjs';
test('a', () => { const s = getSession(); fs.appendFileSync(process.env.SPIKE_LOG, `a pid=${process.pid} session=${s.id} created=${s.created}\n`); });
