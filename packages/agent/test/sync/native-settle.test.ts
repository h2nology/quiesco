import { describe, expect, it } from 'vitest';

import { NativeSettleTracker } from '../../src/sync/native-settle';

describe('NativeSettleTracker', () => {
  it('is idle without a native module, or with one that has no idleState (Android, JS-only builds)', () => {
    expect(new NativeSettleTracker(() => null).isIdle()).toBe(true);
    const android = new NativeSettleTracker(() => ({}));
    expect(android.isIdle()).toBe(true);
    expect(android.describeBusy()).toEqual([]);
  });

  it('reports busy with the native reasons while native UI settles', () => {
    let state = { settling: true, reasons: ['view controller transition in UIWindow'] };
    const t = new NativeSettleTracker(() => ({ idleState: () => state }));
    expect(t.isIdle()).toBe(false);
    expect(t.describeBusy()).toEqual(['view controller transition in UIWindow']);
    state = { settling: true, reasons: [] };
    expect(t.describeBusy()).toEqual(['native UI settling']);
    state = { settling: false, reasons: [] };
    expect(t.isIdle()).toBe(true);
    expect(t.describeBusy()).toEqual([]);
  });

  it('resolves the native module lazily, on each check', () => {
    let mod: { idleState: () => { settling: boolean; reasons: string[] } } | null = null;
    const t = new NativeSettleTracker(() => mod);
    expect(t.isIdle()).toBe(true);
    mod = { idleState: () => ({ settling: true, reasons: ['keyboard moving'] }) };
    expect(t.isIdle()).toBe(false);
  });
});
