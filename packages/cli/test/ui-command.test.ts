import { describe, expect, it, vi } from 'vitest';

import type { UiDeps, UiModule } from '../src/commands/ui';
import { uiCommand } from '../src/commands/ui';
import { fakeContext } from './fake-context';

type ServerOptions = Parameters<UiModule['startUiServer']>[0];

function fakeUi() {
  const started: ServerOptions[] = [];
  const spawned: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
  const close = vi.fn(async () => {});
  const module: UiModule = {
    startUiServer: async (options) => {
      started.push(options);
      return { url: 'http://127.0.0.1:5173/?token=abc', close };
    },
    spawnRun: (command, args, options) => {
      spawned.push({ command, args, env: options.env });
      return { exited: Promise.resolve(0), stop: () => {} };
    },
  };
  return { module, started, spawned, close };
}

function deps(ui: ReturnType<typeof fakeUi> | null, extra: Partial<UiDeps> = {}): UiDeps {
  return {
    loadUi: async () => (ui === null ? null : { module: ui.module, staticDir: '/ui/web' }),
    loadConfig: async () => null,
    listTests: vi.fn(async () => ({ runner: 'cucumber' as const, files: [], tests: [], errors: [] })),
    untilInterrupted: async () => {},
    ...extra,
  };
}

describe('quiesco ui', () => {
  it('tells how to install @quiesco/ui when it is missing', async () => {
    const ctx = fakeContext();
    expect(await uiCommand(['--platform', 'web'], ctx, deps(null))).toBe(1);
    expect(ctx.errors[0]).toMatch(/npm i -D @quiesco\/ui/);
  });

  it('starts the server, prints its URL, closes it when stopped', async () => {
    const ui = fakeUi();
    const ctx = fakeContext();
    expect(await uiCommand(['--platform', 'web', '--port', '5173'], ctx, deps(ui))).toBe(0);
    expect(ui.started[0]).toMatchObject({ cwd: ctx.cwd, runner: 'cucumber', platform: 'web', port: 5173, staticDir: '/ui/web', artifactsDir: `${ctx.cwd}/artifacts` });
    expect(ctx.lines[0]).toBe('quiesco ui: http://127.0.0.1:5173/?token=abc');
    expect(ui.close).toHaveBeenCalled();
  });

  it('runs like quiesco test: runner, workers, user arguments, then the chosen tests; lists with the user arguments', async () => {
    const ui = fakeUi();
    const d = deps(ui);
    const ctx = fakeContext(undefined, { resolveFrom: (_dir, spec) => (spec === '@quiesco/cucumber/events' ? '/p/events-formatter.js' : null) });
    await uiCommand(['--platform', 'ios', '--workers', '2', '--', '--profile', 'smoke'], ctx, d);
    ui.started[0]?.startRun(['features/a.feature:3'], { QUIESCO_EVENTS: '/tmp/q.sock' }, () => {});
    expect(ui.spawned[0]?.command).toBe('npx');
    expect(ui.spawned[0]?.args).toEqual(['cucumber-js', '--parallel', '2', '--format', '"file:///p/events-formatter.js":"/dev/null"', '--profile', 'smoke', 'features/a.feature:3']);
    expect(ui.spawned[0]?.env).toMatchObject({ QUIESCO_PLATFORM: 'ios', QUIESCO_EVENTS: '/tmp/q.sock' });
    await ui.started[0]?.listTests();
    expect(d.listTests).toHaveBeenCalledWith({ runner: 'cucumber', cwd: ctx.cwd, args: ['--profile', 'smoke'], env: ctx.env });
  });

  it('vitest and jest get their own runner commands', async () => {
    for (const [runner, first] of [['vitest', ['vitest', 'run']], ['jest', ['jest']]] as const) {
      const ui = fakeUi();
      await uiCommand(['--platform', 'web', '--runner', runner, '--config', 'x.config'], fakeContext(), deps(ui));
      ui.started[0]?.startRun(['e2e/a.test.ts:5'], {}, () => {});
      expect(ui.spawned[0]?.args).toEqual([...first, '--config', 'x.config', 'e2e/a.test.ts:5']);
    }
  });

  it('opens the browser only for a person at the terminal, not with --no-open', async () => {
    const opened = (ctx: ReturnType<typeof fakeContext>) => ctx.calls.filter((c) => c.command === 'open');
    const person = fakeContext(undefined, { interactive: true });
    await uiCommand(['--platform', 'web'], person, deps(fakeUi()));
    expect(opened(person)).toEqual([{ command: 'open', args: ['http://127.0.0.1:5173/?token=abc'] }]);
    const noOpen = fakeContext(undefined, { interactive: true });
    await uiCommand(['--platform', 'web', '--no-open'], noOpen, deps(fakeUi()));
    expect(opened(noOpen)).toEqual([]);
  });

  it('refuses a missing platform, an unknown runner and bad numbers', async () => {
    expect(await uiCommand([], fakeContext(), deps(fakeUi()))).toBe(2);
    expect(await uiCommand(['--platform', 'web', '--runner', 'mocha'], fakeContext(), deps(fakeUi()))).toBe(2);
    expect(await uiCommand(['--platform', 'web', '--workers', '0'], fakeContext(), deps(fakeUi()))).toBe(2);
    expect(await uiCommand(['--platform', 'web', '--port', 'x'], fakeContext(), deps(fakeUi()))).toBe(2);
  });
});
