import { test as base } from 'vitest';
const test = base.extend({ s: [async ({}, use) => { await new Promise((r) => setTimeout(r, 1000)); await use(1); }, { scope: 'worker' }] });
test('first', ({ s }) => { void s; });
test('second', ({ s }) => { void s; });
