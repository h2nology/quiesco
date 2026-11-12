import { test } from '../fixture.mjs';
test('t3', async ({ session }) => { await new Promise(r => setTimeout(r, 1200)); });
