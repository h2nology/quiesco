import { afterEach, describe, expect, it } from 'vitest';

import { Driver } from '../src/driver';
import { toMatcher } from '../src/matcher';
import type { AgentConnection } from '../src/server/ws-server';
import { QuiescoServer } from '../src/server/ws-server';
import { AGENT_CONFIG, connectAgent } from './helpers/fake-agent';
import type { Handler } from './helpers/fake-agent';
import { FakeProvider } from './helpers/fake-provider';

let server: QuiescoServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

async function setup(handler: Handler = () => ({ elements: [] })) {
  server = new QuiescoServer({ port: 0, host: '127.0.0.1', agentConfig: AGENT_CONFIG });
  const port = await server.start();
  server.expectSession('s');
  const agent = connectAgent(port, { sessionId: 's', handler });
  const conn: AgentConnection = await server.waitForConnection('s', 1000, () => '');
  const driver = new Driver({ provider: new FakeProvider(), connection: async () => conn, defaultTimeoutMs: 1000 });
  driver.attach(conn);
  return { driver, agent };
}

const assertions = (agent: { requests: { method: string; params: Record<string, unknown> }[] }) => agent.requests.map((r) => r.params['assertion']);

describe('toMatcher() (Phase 6.1 fields)', () => {
  it('converts id regex, type, has, not recursively', () => {
    expect(toMatcher({ id: /^todo-\d+$/, type: 'button', has: { text: /milk/i }, not: 'todo-1', within: { type: 'list' } })).toEqual({
      id: { regex: { source: '^todo-\\d+$', flags: '' } },
      type: 'button',
      has: { text: { regex: { source: 'milk', flags: 'i' } } },
      not: { id: 'todo-1' },
      within: { type: 'list' },
    });
  });
});

describe('Driver state assertions', () => {
  it('sends one assertion per expectXxx method', async () => {
    const { driver, agent } = await setup();
    await driver.expectVisible('a', { ratio: 0.75, timeoutMs: 300 });
    await driver.expectFocused('a');
    await driver.expectNotFocused('a');
    await driver.expectEnabled('a');
    await driver.expectDisabled('a');
    await driver.expectChecked('a');
    await driver.expectNotChecked('a');
    await driver.expectValue('a', 0.5);
    await driver.expectValue('a', /^b/);
    await driver.expectLabel('a', 'Close');
    const m = { id: 'a' };
    expect(assertions(agent)).toEqual([
      { type: 'visible', matcher: m, ratio: 0.75 },
      { type: 'focused', matcher: m },
      { type: 'notFocused', matcher: m },
      { type: 'enabled', matcher: m },
      { type: 'disabled', matcher: m },
      { type: 'checked', matcher: m },
      { type: 'notChecked', matcher: m },
      { type: 'value', matcher: m, expected: 0.5 },
      { type: 'value', matcher: m, expected: { regex: { source: '^b', flags: '' } } },
      { type: 'label', matcher: m, expected: 'Close' },
    ]);
    expect(agent.requests[0]?.params['timeoutMs']).toBe(300);
  });

  it('rejects a ratio outside (0, 1]', async () => {
    const { driver } = await setup();
    expect(() => driver.expectVisible('a', { ratio: 75 })).toThrow(RangeError);
    expect(() => driver.expect('a').toBeVisible({ ratio: 0 })).toThrow(RangeError);
  });

  it('attributes() returns the single element, MULTIPLE_MATCHES for several', async () => {
    let elements: unknown[] = [{ testID: 'a', semanticType: 'button' }];
    const { driver, agent } = await setup(() => ({ elements }));
    await expect(driver.attributes({ type: 'button' })).resolves.toEqual({ testID: 'a', semanticType: 'button' });
    expect(assertions(agent)[0]).toEqual({ type: 'exists', matcher: { type: 'button' } });
    elements = [{ testID: 'a' }, { testID: 'b' }];
    await expect(driver.attributes({ type: 'button' })).rejects.toMatchObject({ errorName: 'MULTIPLE_MATCHES' });
  });
});

describe('chained expect()', () => {
  it('maps every matcher and its .not to the same assertions as expectXxx', async () => {
    const { driver, agent } = await setup();
    const e = driver.expect('a');
    await e.toBeVisible();
    await e.not.toBeVisible({ ratio: 0.5 });
    await e.toExist();
    await e.not.toExist();
    await e.toBeFocused();
    await e.not.toBeFocused();
    await e.toBeEnabled();
    await e.not.toBeEnabled();
    await e.toBeDisabled();
    await e.not.toBeDisabled();
    await e.toBeChecked();
    await e.not.toBeChecked();
    await e.toHaveText(/milk/);
    await e.not.toHaveText('x');
    await e.not.toHaveValue(3);
    await e.toHaveLabel('L');
    await e.not.toHaveProp('p', 1);
    await e.not.toHaveCount(2);
    await e.toHaveId(/^a/);
    await e.not.not.toExist();
    const m = { id: 'a' };
    expect(assertions(agent)).toEqual([
      { type: 'visible', matcher: m },
      { type: 'notVisible', matcher: m, ratio: 0.5 },
      { type: 'exists', matcher: m },
      { type: 'notExists', matcher: m },
      { type: 'focused', matcher: m },
      { type: 'notFocused', matcher: m },
      { type: 'enabled', matcher: m },
      { type: 'disabled', matcher: m },
      { type: 'disabled', matcher: m },
      { type: 'enabled', matcher: m },
      { type: 'checked', matcher: m },
      { type: 'notChecked', matcher: m },
      { type: 'text', matcher: m, expected: { regex: { source: 'milk', flags: '' } } },
      { type: 'text', matcher: m, expected: 'x', not: true },
      { type: 'value', matcher: m, expected: 3, not: true },
      { type: 'label', matcher: m, expected: 'L' },
      { type: 'prop', matcher: m, prop: 'p', expected: 1, not: true },
      { type: 'count', matcher: m, expected: 2, not: true },
      { type: 'exists', matcher: { id: { regex: { source: '^a', flags: '' } } } },
      { type: 'exists', matcher: m },
    ]);
  });
});
