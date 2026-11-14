import { describe, expect, it } from 'vitest';

import { QuiescoError } from '../src/errors';
import { RepeatedFailures, failureSignature } from '../src/repeated-failures';

const timeout = (ms: number, id = 'home') => new QuiescoError('ASSERTION_FAILED', `expect visible failed after ${ms}ms for { id: "${id}" }: expected "visible", actual "not visible"\n    at somewhere`);

describe('failureSignature', () => {
  it('is the error name and the first message line, numbers left out', () => {
    expect(failureSignature(timeout(10012))).toBe(failureSignature(timeout(10009)));
    expect(failureSignature(timeout(10012))).not.toBe(failureSignature(timeout(10012, 'search')));
    expect(failureSignature(timeout(1))).toMatch(/^ASSERTION_FAILED: expect visible failed after Nms/);
    // cucumber-js gives the formatted message (with the stack) as a string
    expect(failureSignature('\nQuiescoError: Soft reset failed at navigation: x\n    at y')).toBe('Error: QuiescoError: Soft reset failed at navigation: x');
    expect(failureSignature(new TypeError('boom'))).toBe('TypeError: boom');
    expect(failureSignature({ message: 'plain' })).toBe('Error: plain');
    expect(failureSignature({ type: 'QuiescoError', message: 'x 1' })).toBe('QuiescoError: x N');
    expect(failureSignature([new TypeError('first'), new Error('async')])).toBe('TypeError: first');
    expect(failureSignature(undefined)).toBe('Error: undefined');
  });
});

describe('RepeatedFailures', () => {
  const fail = (ms: number, id?: string) => ({ failed: true, error: timeout(ms, id) });

  it('hints once and bails after N identical failures in a row', async () => {
    const r = new RepeatedFailures(3);
    expect(await r.record(fail(10001))).toBeNull();
    expect(await r.record(fail(10002))).toBeNull();
    const hint = await r.record(fail(10003), async () => '/students/new');
    expect(hint?.bail).toBe(true);
    expect(hint?.message).toContain('the last 3 scenarios failed the same way: ASSERTION_FAILED: expect visible failed after 10003ms');
    expect(hint?.message).toContain('(current route: /students/new)');
    expect(hint?.message).toContain('bailOnRepeatedFailure: 3');
    expect(r.bailedOut).toMatch(/^skipped: the 3 scenarios before it failed the same way/);
    expect(await r.record(fail(10004))).toBeNull(); // once per streak
  });

  it('a pass or a different failure ends the streak', async () => {
    const r = new RepeatedFailures(2);
    await r.record(fail(1));
    await r.record({ failed: false });
    expect(await r.record(fail(1))).toBeNull();
    expect(await r.record(fail(1, 'other'))).toBeNull();
    expect(await r.record(fail(1, 'other'))).not.toBeNull();
  });

  it('false: hint at 3 without bailing; bad values are refused', async () => {
    const r = new RepeatedFailures(false);
    await r.record(fail(1));
    await r.record(fail(1));
    const hint = await r.record(fail(1));
    expect(hint?.bail).toBe(false);
    expect(hint?.message).toContain('reset.expectVisible');
    expect(r.bailedOut).toBeNull();
    expect(() => new RepeatedFailures(0)).toThrow(/whole number ≥ 1 or false/);
    expect(() => new RepeatedFailures(1.5)).toThrow();
  });

  it('a route that cannot be read leaves it out', async () => {
    const r = new RepeatedFailures(1);
    const hint = await r.record(fail(1), () => Promise.reject(new Error('gone')));
    expect(hint?.message).not.toContain('current route');
  });
});
