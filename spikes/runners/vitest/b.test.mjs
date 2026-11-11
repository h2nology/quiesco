import fs from 'node:fs';
import { test } from 'vitest';
import { getSession } from './shared.mjs';
test('b', () => { const s = getSession(); fs.appendFileSync(process.env.SPIKE_LOG, `b pid=${process.pid} session=${s.id} created=${s.created}\n`); });
