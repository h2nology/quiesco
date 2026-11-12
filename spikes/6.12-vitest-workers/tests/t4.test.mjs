import { test } from '../fixture.mjs';
test('t4', async ({ session }) => { await new Promise(r => setTimeout(r, 1200)); });
