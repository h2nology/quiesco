import path from 'node:path';
import { Writable } from 'node:stream';

import { loadConfiguration, runCucumber } from '@cucumber/cucumber/api';
import type { Envelope } from '@cucumber/messages';
import { describe, expect, it } from 'vitest';

const cwd = path.resolve(__dirname, 'fixtures/project');
const sink = () => new Writable({ write: (_c, _e, cb) => cb() });

describe('registerQuiesco inside a real cucumber-js run', () => {
  it('resets per scenario, skips other platforms, attaches evidence on failure, disposes', async () => {
    const { runConfiguration } = await loadConfiguration(
      { provided: { paths: ['features/**/*.feature'], import: ['features/support/**/*.mjs'], format: [] } },
      { cwd, stdout: sink(), stderr: sink() },
    );
    const envelopes: Envelope[] = [];
    const result = await runCucumber(runConfiguration, { cwd, stdout: sink(), stderr: sink() }, (e) => envelopes.push(e));
    expect(result.success).toBe(false); // the "fails with evidence" scenario

    const log = (globalThis as { __quiescoTestLog?: string[] }).__quiescoTestLog;
    expect(log).toEqual(['reset soft', 'tap add', 'reset hard', 'tap x', 'reset soft', 'tap broken', 'dispose']);

    const names = new Map(envelopes.flatMap((e) => (e.pickle ? [[e.pickle.id, e.pickle.name] as const] : [])));
    const caseToPickle = new Map(envelopes.flatMap((e) => (e.testCase ? [[e.testCase.id, e.testCase.pickleId] as const] : [])));
    const startedToCase = new Map(envelopes.flatMap((e) => (e.testCaseStarted ? [[e.testCaseStarted.id, e.testCaseStarted.testCaseId] as const] : [])));
    const statuses: Record<string, string[]> = {};
    for (const e of envelopes) {
      if (!e.testStepFinished) continue;
      const name = names.get(caseToPickle.get(startedToCase.get(e.testStepFinished.testCaseStartedId) ?? '') ?? '') ?? '?';
      (statuses[name] ??= []).push(e.testStepFinished.testStepResult.status);
    }
    // Before hook skipped → the step is skipped; the After hook itself still runs and passes.
    expect(statuses['web only']).toEqual(['SKIPPED', 'SKIPPED', 'PASSED']);
    expect(statuses['runs everywhere']?.every((s) => s === 'PASSED')).toBe(true);
    expect(statuses['fails with evidence']).toContain('FAILED');

    const attachments = envelopes.flatMap((e) => (e.attachment ? [e.attachment.mediaType] : []));
    expect(attachments).toEqual(['image/png', 'application/json']);
  });
});
