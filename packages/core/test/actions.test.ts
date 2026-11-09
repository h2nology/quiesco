import { afterEach, describe, expect, it } from 'vitest';

import { Driver } from '../src/driver';
import type { AgentConnection } from '../src/server/ws-server';
import { QuiescoServer } from '../src/server/ws-server';
import { AGENT_CONFIG, connectAgent } from './helpers/fake-agent';
import { FakeProvider } from './helpers/fake-provider';

let server: QuiescoServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

async function setup() {
  server = new QuiescoServer({ port: 0, host: '127.0.0.1', agentConfig: AGENT_CONFIG });
  const port = await server.start();
  server.expectSession('s');
  const agent = connectAgent(port, { sessionId: 's', handler: () => ({}) });
  const conn: AgentConnection = await server.waitForConnection('s', 1000, () => '');
  const driver = new Driver({ provider: new FakeProvider(), connection: async () => conn, defaultTimeoutMs: 1000, mode: 'native' });
  driver.attach(conn);
  return { driver, actions: () => agent.requests.map((r) => r.params['action']) };
}

describe('Driver actions (Phase 6.2)', () => {
  it('converts the new actions into protocol specs', async () => {
    const { driver, actions } = await setup();
    await driver.tap('a', { point: { x: 5, y: 6 } });
    await driver.longPress('a', { point: { x: 1, y: 2 }, durationMs: 900 });
    await driver.multiTap('a', 3);
    await driver.replaceText('a', 'new');
    await driver.pressKey('a', 'enter');
    await driver.scroll('a', 'down', { distance: 50, from: { x: 0.5, y: 0.9 } });
    await driver.swipe('a', 'left', { speed: 'fast', distance: 100, from: { x: 1, y: 0.5 } });
    await driver.scrollToEdge('a', 'bottom');
    await driver.scrollToIndex({ type: 'list' }, 42, { viewPosition: 0.5 });
    await driver.drag('card', 'slot', { holdMs: 500, speed: 'slow' });
    await driver.drag('card', { point: { x: 10, y: 20 } });
    await driver.tapAt({ x: 3, y: 4 });
    await driver.longPressAt({ x: 3, y: 4 }, { durationMs: 1000 });
    const m = { id: 'a' };
    expect(actions()).toEqual([
      { type: 'tap', matcher: m, point: { x: 5, y: 6 } },
      { type: 'longPress', matcher: m, durationMs: 900, point: { x: 1, y: 2 } },
      { type: 'multiTap', matcher: m, count: 3 },
      { type: 'replaceText', matcher: m, text: 'new' },
      { type: 'pressKey', matcher: m, key: 'enter' },
      { type: 'scroll', matcher: m, direction: 'down', distance: 50, from: { x: 0.5, y: 0.9 } },
      { type: 'swipe', matcher: m, direction: 'left', speed: 'fast', distance: 100, from: { x: 1, y: 0.5 } },
      { type: 'scrollToEdge', matcher: m, edge: 'bottom' },
      { type: 'scrollToIndex', matcher: { type: 'list' }, index: 42, viewPosition: 0.5 },
      { type: 'drag', matcher: { id: 'card' }, to: { matcher: { id: 'slot' } }, holdMs: 500, speed: 'slow' },
      { type: 'drag', matcher: { id: 'card' }, to: { point: { x: 10, y: 20 } } },
      { type: 'tapAt', point: { x: 3, y: 4 } },
      { type: 'longPressAt', point: { x: 3, y: 4 }, durationMs: 1000 },
    ]);
  });

  it('rejects bad arguments before sending anything', async () => {
    const { driver, actions } = await setup();
    expect(() => driver.multiTap('a', 0)).toThrow(RangeError);
    expect(() => driver.scrollToIndex('a', -1)).toThrow(RangeError);
    expect(() => driver.scrollToIndex('a', 1, { viewPosition: 2 })).toThrow(RangeError);
    expect(() => driver.swipe('a', 'up', { from: { x: 1.5, y: 0 } })).toThrow(RangeError);
    expect(() => driver.tap('a', { point: { x: Number.NaN, y: 0 } })).toThrow(RangeError);
    expect(() => driver.pressKey('a', 'tab' as never)).toThrow(RangeError);
    expect(() => driver.scrollToEdge('a', 'middle' as never)).toThrow(RangeError);
    expect(actions()).toEqual([]);
  });
});

describe('Driver value controls (Phase 6.3)', () => {
  it('setValue sends dates as ISO strings; adjustSlider and accessibilityAction pass through', async () => {
    const { driver, actions } = await setup();
    const d = new Date(Date.UTC(2027, 2, 8, 3));
    await driver.setValue('slider', 35);
    await driver.setValue('switch', true);
    await driver.setValue('picker', 'Durian');
    await driver.setValue('when', d);
    await driver.adjustSlider('slider', 0.75);
    await driver.accessibilityAction('stepper', 'increment');
    expect(actions()).toEqual([
      { type: 'setValue', matcher: { id: 'slider' }, value: 35 },
      { type: 'setValue', matcher: { id: 'switch' }, value: true },
      { type: 'setValue', matcher: { id: 'picker' }, value: 'Durian' },
      { type: 'setValue', matcher: { id: 'when' }, value: { date: '2027-03-08T03:00:00.000Z' } },
      { type: 'adjustSlider', matcher: { id: 'slider' }, position: 0.75 },
      { type: 'accessibilityAction', matcher: { id: 'stepper' }, name: 'increment' },
    ]);
  });

  it('rejects bad arguments before sending anything', async () => {
    const { driver, actions } = await setup();
    expect(() => driver.setValue('a', new Date(Number.NaN))).toThrow(RangeError);
    expect(() => driver.setValue('a', Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => driver.setValue('a', { x: 1 } as never)).toThrow(RangeError);
    expect(() => driver.adjustSlider('a', 1.2)).toThrow(RangeError);
    expect(() => driver.accessibilityAction('a', '')).toThrow(RangeError);
    expect(actions()).toEqual([]);
  });
});
