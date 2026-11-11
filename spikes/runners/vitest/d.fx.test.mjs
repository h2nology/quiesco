import fs from 'node:fs';
import { test } from './fixture.mjs';
test('d', ({ session }) => { fs.appendFileSync(process.env.SPIKE_LOG, `d session=${session.id}\n`); });
