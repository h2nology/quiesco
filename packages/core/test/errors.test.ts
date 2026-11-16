import { describe, expect, it } from 'vitest';

import { QuiescoError, withCallSite } from '../src/errors';

const OWN = new URL('../src/', import.meta.url).href;

describe('withCallSite (issue #32)', () => {
  it('keeps only the frames outside Quiesco, ws and Node (installed-package paths as in the issue)', () => {
    const site = new Error('call site');
    site.stack = [
      'Error: call site',
      `    at Driver.request (${OWN}driver.js:620:18)`,
      `    at Driver.call (${OWN}driver.js:599:17)`,
      '    at StudentDriver.pickBirthday (file:///app/features/support/student-driver.ts:42:20)',
      '    at World.<anonymous> (file:///app/features/steps/students.steps.ts:12:3)',
      '    at Receiver.receiverOnMessage (/app/node_modules/.pnpm/ws@8.22.1/node_modules/ws/lib/websocket.js:1258:20)',
      '    at WebSocket.emit (node:events:514:28)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
    ].join('\n');
    const e = withCallSite(new QuiescoError('ELEMENT_NOT_VISIBLE', 'not visible'), site);
    expect(e.stack).toBe(
      [
        'QuiescoError: not visible',
        '    at StudentDriver.pickBirthday (file:///app/features/support/student-driver.ts:42:20)',
        '    at World.<anonymous> (file:///app/features/steps/students.steps.ts:12:3)',
      ].join('\n'),
    );
  });

  it('leaves the stack alone when every frame is internal', () => {
    const e = new QuiescoError('AGENT_TIMEOUT', 'late');
    const before = e.stack;
    const site = new Error('call site');
    site.stack = `Error: call site\n    at Driver.request (${OWN}driver.js:1:1)`;
    expect(withCallSite(e, site).stack).toBe(before);
  });
});
