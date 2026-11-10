import { afterEach, describe, expect, it } from 'vitest';

import { Driver } from '../src/driver';
import type { AgentConnection } from '../src/server/ws-server';
import { QuiescoServer } from '../src/server/ws-server';
import { AGENT_CONFIG, NO_REPLY, connectAgent } from './helpers/fake-agent';
import type { Handler } from './helpers/fake-agent';
import { FakeProvider } from './helpers/fake-provider';

/** A web-like provider whose page can open a JS dialog that blocks input until answered. */
class DialogProvider extends FakeProvider {
  message: string | null = null;
  private readonly listeners = new Set<(m: string) => void>();
  /** What the next injectInput does: open a dialog and stay blocked. */
  opensDialog = false;
  blockingDialog(): string | null {
    return this.message;
  }
  onBlockingDialog(l: (m: string) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  open(message: string): void {
    this.message = message;
    for (const l of [...this.listeners]) l(message);
  }
  override async injectInput(input: Parameters<FakeProvider['injectInput']>[0]): Promise<void> {
    await super.injectInput(input);
    if (this.opensDialog) {
      this.open('删除全部?');
      await new Promise(() => undefined);
    }
  }
}

let server: QuiescoServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

async function setup(handler: Handler = () => ({}), opts: { nativeModule?: boolean; mode?: 'js' | 'native'; provider?: FakeProvider } = {}) {
  server = new QuiescoServer({ port: 0, host: '127.0.0.1', agentConfig: AGENT_CONFIG });
  const port = await server.start();
  server.expectSession('s');
  const agent = connectAgent(port, { sessionId: 's', handler, ...(opts.nativeModule !== undefined ? { nativeModule: opts.nativeModule } : {}) });
  const conn: AgentConnection = await server.waitForConnection('s', 1000, () => '');
  const provider = opts.provider ?? new FakeProvider();
  const driver = new Driver({ provider, connection: async () => conn, defaultTimeoutMs: 1000, ...(opts.mode !== undefined ? { mode: opts.mode } : {}) });
  driver.attach(conn);
  return { driver, agent, provider, conn };
}

describe('Driver', () => {
  it('converts matchers (string = testID, RegExp text) and options into protocol params', async () => {
    const { driver, agent } = await setup((m) => (m === 'action' ? { element: { testID: 'submit' } } : { elements: [] }));
    await driver.tap('submit');
    await driver.type({ id: 'title', within: 'form' }, 'Buy milk', { timeoutMs: 500, sync: false });
    await driver.expectText({ text: /^todo/i }, /^Buy/);
    await driver.longPress('row', { durationMs: 800 });
    expect(agent.requests).toEqual([
      { method: 'action', params: { action: { type: 'tap', matcher: { id: 'submit' } }, mode: 'js' } },
      { method: 'action', params: { action: { type: 'type', matcher: { id: 'title', within: { id: 'form' } }, text: 'Buy milk' }, mode: 'js', sync: false, timeoutMs: 500 } },
      { method: 'assert', params: { assertion: { type: 'text', matcher: { text: { regex: { source: '^todo', flags: 'i' } } }, expected: { regex: { source: '^Buy', flags: '' } } } } },
      { method: 'action', params: { action: { type: 'longPress', matcher: { id: 'row' }, durationMs: 800 }, mode: 'js' } },
    ]);
  });

  it('uses native mode when the app has @quiesco/native, unless configured', async () => {
    const a = await setup(() => ({}), { nativeModule: true });
    await a.driver.tap('x');
    expect(a.agent.requests[0]?.params['mode']).toBe('native');
    await server?.stop();
    const b = await setup(() => ({}), { nativeModule: true, mode: 'js' });
    await b.driver.tap('x');
    expect(b.agent.requests[0]?.params['mode']).toBe('js');
  });

  it('hands hostInput to the provider and then waits for idle', async () => {
    const { driver, agent, provider } = await setup((m, p) => {
      if (m === 'action') return (p['action'] as { type: string }).type === 'pressBack' ? { hostInput: { kind: 'back' } } : { hostInput: { kind: 'navigate', url: 'app://todos' } };
      return { waitedMs: 3 };
    });
    await driver.pressBack();
    await driver.openUrl('app://todos');
    expect(provider.inputs).toEqual([{ kind: 'back' }, { kind: 'navigate', url: 'app://todos' }]);
    expect(agent.requests.map((r) => r.method)).toEqual(['action', 'waitForIdle', 'action', 'waitForIdle']);
  });

  it('an action whose tap opens a JS dialog returns once the dialog is up, without waiting for idle', async () => {
    const provider = new DialogProvider();
    provider.opensDialog = true;
    const { driver, agent } = await setup((m) => (m === 'action' ? { element: { testID: 'clear' }, hostInput: { kind: 'tap', x: 1, y: 2 } } : NO_REPLY), { provider, mode: 'native' });
    await expect(driver.tap('clear')).resolves.toEqual({ testID: 'clear' });
    expect(agent.requests.map((r) => r.method)).toEqual(['action']);
  });

  it('js mode: the agent call blocked by the dialog it opened is left behind', async () => {
    const provider = new DialogProvider();
    const { driver } = await setup((m) => {
      if (m === 'action') {
        provider.open('确定?');
        return NO_REPLY;
      }
      return {};
    }, { provider, mode: 'js' });
    await expect(driver.tap('clear', { timeoutMs: 60_000 })).resolves.toBeUndefined();
  });

  it('a dialog opened while waiting for idle after the input ends the action too', async () => {
    const provider = new DialogProvider();
    const { driver } = await setup((m) => {
      if (m === 'action') return { hostInput: { kind: 'tap', x: 1, y: 2 } };
      setTimeout(() => provider.open('later'), 10);
      return NO_REPLY;
    }, { provider, mode: 'native' });
    await expect(driver.tap('x', { timeoutMs: 60_000 })).resolves.toBeUndefined();
  });

  it('fails fast with DIALOG_OPEN while the page shows a dialog', async () => {
    const provider = new DialogProvider();
    const { driver, agent } = await setup(() => ({ elements: [] }), { provider });
    provider.open('删除全部?');
    await expect(driver.expectVisible('x')).rejects.toMatchObject({ errorName: 'DIALOG_OPEN', data: { message: '删除全部?' } });
    await expect(driver.tap('x')).rejects.toThrow(/system\.tap/);
    expect(agent.requests).toEqual([]);
    provider.message = null;
    await expect(driver.expectVisible('x')).resolves.toEqual([]);
  });

  it('backdoor checks arguments on the host and returns the value; reset returns the duration', async () => {
    const { driver } = await setup((m, p) => (m === 'backdoor' ? { value: { got: p['args'] } } : { durationMs: 42 }));
    await expect(driver.backdoor('seedTodos', ['a', 'b'])).resolves.toEqual({ got: [['a', 'b']] });
    await expect(driver.backdoor('x', new Date() as never)).rejects.toMatchObject({ errorName: 'NOT_SERIALIZABLE', data: { path: '$args[0]' } });
    await expect(driver.reset()).resolves.toBe(42);
  });

  it('fails the running call immediately when the app reports an uncaught error', async () => {
    const { driver, agent } = await setup(() => NO_REPLY);
    const p = driver.tap('x', { timeoutMs: 10_000 });
    agent.notify('error', { kind: 'redbox', message: 'undefined is not a function', stack: 'at App', timestamp: 1 });
    await expect(p).rejects.toMatchObject({ errorName: 'APP_ERROR', data: { kind: 'redbox', stack: 'at App' } });
  });

  it('logs instead of failing for ignored app errors', async () => {
    const { conn, agent } = await setup(() => ({ root: null }));
    const warnings: string[] = [];
    const d = new Driver({
      provider: new FakeProvider(),
      connection: async () => conn,
      defaultTimeoutMs: 1000,
      ignoreAppErrors: [/^Requiring unknown module/],
      logger: { debug() {}, info() {}, warn: (m) => warnings.push(m), error() {} },
    });
    d.attach(conn);
    const seen = new Promise((r) => conn.once('appError', r));
    agent.notify('error', { kind: 'redbox', message: 'Requiring unknown module "818".', timestamp: 1 });
    await seen;
    await expect(d.getTree()).resolves.toBeNull();
    expect(warnings).toEqual(['ignored app error (redbox): Requiring unknown module "818".']);
  });

  it('reports an app error raised between calls on the next call', async () => {
    const { driver, agent, conn } = await setup(() => ({ root: null }));
    const seen = new Promise((r) => conn.once('appError', r));
    agent.notify('error', { kind: 'uncaught', message: 'late', timestamp: 1 });
    await seen;
    await expect(driver.getTree()).rejects.toMatchObject({ errorName: 'APP_ERROR', message: expect.stringContaining('late') });
    await expect(driver.getTree()).resolves.toBeNull();
  });

  it('keeps agent error codes and data', async () => {
    const { driver } = await setup(() => {
      throw { code: 1004, message: 'expect text failed', data: { name: 'ASSERTION_FAILED', expected: '1', actual: '0', elements: [] } };
    });
    await expect(driver.expectText('count', '1')).rejects.toMatchObject({ errorName: 'ASSERTION_FAILED', code: 1004, data: { expected: '1', actual: '0' } });
  });

  it('repeats a read-only call once when the connection drops mid-call, but not an action', async () => {
    server = new QuiescoServer({ port: 0, host: '127.0.0.1', agentConfig: AGENT_CONFIG });
    const port = await server.start();
    server.expectSession('s');
    const first = connectAgent(port, { sessionId: 's', handler: () => NO_REPLY });
    let conn: AgentConnection = await server.waitForConnection('s', 1000, () => '');
    const provider = new FakeProvider();
    const driver = new Driver({
      provider,
      connection: async () => (conn.closed ? (conn = await server!.waitForConnection('s', 1000, () => '', conn)) : conn),
      defaultTimeoutMs: 1000,
    });
    const tree = driver.getTree();
    const tap = driver.tap('x').catch((e: unknown) => e); // handled right away (rejects before we await it)
    await expect.poll(() => first.requests.length).toBe(2); // both calls reached the app
    first.ws.terminate(); // e.g. a web page reload
    connectAgent(port, { sessionId: 's', handler: (m) => (m === 'getTree' ? { root: null } : {}) });
    await expect(tree).resolves.toBeNull();
    await expect(tap).resolves.toMatchObject({ errorName: 'AGENT_DISCONNECTED' });
  });

  it('uses native (host-injected) mode on the web even without @quiesco/native', async () => {
    const { agent, provider } = await setup(() => ({}));
    Object.defineProperty(provider, 'platform', { value: 'web' });
    const d = new Driver({ provider, connection: async () => (await server!.waitForConnection('s', 1000, () => '')), defaultTimeoutMs: 1000 });
    await d.tap('x');
    expect(agent.requests.at(-1)?.params['mode']).toBe('native');
  });
});
