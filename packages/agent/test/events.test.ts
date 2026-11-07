import { describe, expect, it, vi } from 'vitest';

import { EventForwarder } from '../src/events';

function setup() {
  const sent: [string, Record<string, unknown>][] = [];
  const original = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const target: Record<string, unknown> = { console: { ...original } };
  const f = new EventForwarder({ notify: (e, p) => sent.push([e, p as unknown as Record<string, unknown>]), target, now: () => 5 });
  return { f, target, sent, original };
}

describe('EventForwarder', () => {
  it('forwards console output at or above the level and still calls the original', () => {
    const { f, target, sent, original } = setup();
    f.install();
    const c = target['console'] as Record<string, (...a: unknown[]) => void>;
    c['log']!('hidden');
    c['warn']!('careful', { a: 1 });
    expect(sent).toEqual([['log', { level: 'warn', message: 'careful {"a":1}', timestamp: 5 }]]);
    expect(original.log).toHaveBeenCalledWith('hidden');
    f.setLevel('off');
    c['error']!('x');
    expect(sent).toHaveLength(1);
    f.setLevel('debug');
    c['log']!('now');
    expect(sent[1]?.[1]).toMatchObject({ level: 'info', message: 'now' });
    f.uninstall();
    expect(c['log']).toBe(original.log);
  });

  it('wraps ErrorUtils and keeps the previous handler', () => {
    const { f, target, sent } = setup();
    const previous = vi.fn();
    let handler = previous as (e: unknown, fatal?: boolean) => void;
    target['ErrorUtils'] = { getGlobalHandler: () => handler, setGlobalHandler: (h: typeof handler) => (handler = h) };
    f.install();
    handler(new Error('boom'), true);
    expect(sent[0]).toEqual(['error', expect.objectContaining({ kind: 'redbox', message: 'boom', stack: expect.any(String) })]);
    expect(previous).toHaveBeenCalled();
    f.uninstall();
    expect(handler).toBe(previous);
  });

  it('listens to window error and unhandledrejection events', () => {
    const { f, target, sent } = setup();
    const listeners = new Map<string, (ev: unknown) => void>();
    target['window'] = { addEventListener: (t: string, l: (ev: unknown) => void) => listeners.set(t, l), removeEventListener: (t: string) => listeners.delete(t) };
    f.install();
    listeners.get('error')!({ error: new Error('e1') });
    listeners.get('unhandledrejection')!({ reason: 'nope' });
    expect(sent.map(([, p]) => [p['kind'], p['message']])).toEqual([['uncaught', 'e1'], ['unhandledRejection', 'nope']]);
    f.uninstall();
    expect(listeners.size).toBe(0);
  });

  it('does not recurse when notify itself logs', () => {
    const target: Record<string, unknown> = { console: { warn: () => {} } };
    let calls = 0;
    const f = new EventForwarder({
      notify: () => {
        calls++;
        (target['console'] as { warn: (m: string) => void }).warn('from notify');
      },
      target,
    });
    f.install();
    (target['console'] as { warn: (m: string) => void }).warn('x');
    expect(calls).toBe(1);
  });
});
