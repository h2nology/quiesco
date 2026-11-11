import fs from 'node:fs';
import { test } from './fixture.mjs';
test('e', ({ session }) => { fs.appendFileSync(process.env.SPIKE_LOG, `e session=${session.id}\n`); });
