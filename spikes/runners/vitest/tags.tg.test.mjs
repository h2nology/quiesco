import fs from 'node:fs';
import { describe, test } from 'vitest';
const log = (m) => fs.appendFileSync(process.env.SPIKE_LOG, `${m}\n`);
describe('suite', { tags: ['@android'] }, () => {
  test('t1', { tags: ['@ios'] }, ({ task }) => log(`t1 tags=${JSON.stringify(task.tags)} suiteTags=${JSON.stringify(task.suite?.tags)}`));
  test('t2', ({ task }) => log(`t2 tags=${JSON.stringify(task.tags)}`));
});
