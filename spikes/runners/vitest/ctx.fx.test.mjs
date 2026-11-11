import fs from 'node:fs';
import { test as base } from 'vitest';
const log = (m) => fs.appendFileSync(process.env.SPIKE_LOG, `${m}\n`);
const test = base.extend({
  app: [
    async ({ task, skip, onTestFailed, annotate }, use) => {
      const names = []; for (let s = task.suite; s; s = s.suite) names.unshift(s.name);
      log(`before ${task.name} suites=${JSON.stringify(names)} meta=${JSON.stringify(task.meta)} tags=${JSON.stringify(task.tags ?? null)}`);
      if (task.name.includes('@android')) skip('not on this platform');
      let failed = false;
      onTestFailed(async (c) => { failed = true; try { await c.annotate('evidence via onTestFailed', { path: './fixture.mjs', contentType: 'text/plain' }); log('onTestFailed annotate ok'); } catch (e) { log('onTestFailed annotate threw ' + e.message); } });
      await use({});
      log(`teardown ${task.name} failed=${failed} state=${task.result?.state} errors=${task.result?.errors?.length ?? 0}`);
      if (task.result?.state === 'fail') { const err = task.result.errors?.[0]; if (err) err.message += '\n\nQuiesco evidence: artifacts/run/fails';  try { const a = await annotate('evidence: artifacts/x', { path: './fixture.mjs', contentType: 'text/plain' }); log('annotated ' + JSON.stringify(a).slice(0, 160)); } catch (e) { log('annotate threw ' + e.message); } log('annotations ' + JSON.stringify(task.annotations ?? null).slice(0,160)); }
    },
    { auto: false },
  ],
});
test('passes @ios', ({ app }) => { void app; });
test('fails @ios', ({ app }) => { void app; throw new Error('boom'); });
test('skipped @android', ({ app }) => { void app; });
