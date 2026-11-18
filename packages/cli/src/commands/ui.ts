/**
 * `quiesco ui [--platform …] [--runner …] [--workers N] [--port N] [--no-open] [runner arguments…]` (P5):
 * the test UI. Serves @quiesco/ui (installed in the project, loaded only here so the CLI stays small)
 * on 127.0.0.1, keeps the Metro dev server up while it runs, and runs what the browser asks for the way
 * `quiesco test` would (same runner, runner arguments, workers and cucumber formatter) with the chosen
 * tests added. Ctrl-C stops it.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { QuiescoConfig, RunnerName, TestList } from '@quiesco/core';
import { listTests } from '@quiesco/core';

import type { CliContext } from '../context.js';
import { parsePlatform, takeFlag, takeOption } from '../context.js';
import { projectRunner } from '../runner.js';
import { ensureDevServer } from '../dev-server.js';
import { cucumberFormatArgs } from '../progress/run.js';
import { RUNNERS, defaultTestDeps, isRunner } from './test.js';

export const UI_HELP = `Usage: quiesco ui [options] [runner arguments…]

Opens the test UI in the browser: the test tree, run all / a file / a test with a click, live progress,
failures with Quiesco's evidence. Needs @quiesco/ui in the project (npm i -D @quiesco/ui).

Options:
  --platform ios|android|web     Platform to test (or set QUIESCO_PLATFORM)
  --runner cucumber|jest|vitest  Test runner (default: the one whose @quiesco package
                                 is installed; cucumber when several or none are)
  --workers N                    Run N workers, each on a device of its own
  --port N                       Port of the UI (default: a free one)
  --no-open                      Do not open the browser
  -h, --help                     Show this help

Runner arguments (e.g. --config vitest.e2e.config.mts) are used for every run and for listing the tests.

Examples:
  quiesco ui --platform web
  quiesco ui --platform ios --runner vitest --config vitest.e2e.config.mts`;

/** The parts of @quiesco/ui the CLI uses (structural: the CLI does not depend on it). */
interface RunHandleLike {
  readonly exited: Promise<number>;
  stop(graceMs?: number): void;
}
export interface UiModule {
  startUiServer(options: {
    cwd: string;
    runner: RunnerName;
    platform: string;
    startRun(args: string[], env: Record<string, string>, onOutput: (stream: 'stdout' | 'stderr', text: string) => void): RunHandleLike;
    listTests(): Promise<TestList>;
    artifactsDir: string;
    staticDir: string | null;
    port?: number;
  }): Promise<{ url: string; close(): Promise<void> }>;
  spawnRun(command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; onOutput: (stream: 'stdout' | 'stderr', text: string) => void }): RunHandleLike;
}

export interface UiDeps {
  loadUi(ctx: CliContext): Promise<{ module: UiModule; staticDir: string | null } | null>;
  loadConfig(cwd: string, env: NodeJS.ProcessEnv): Promise<QuiescoConfig | null>;
  listTests: typeof listTests;
  /** Resolves when the user stops the UI (Ctrl-C). */
  untilInterrupted(ctx: CliContext): Promise<void>;
}

export const defaultUiDeps: UiDeps = {
  loadUi: async (ctx) => {
    const entry = ctx.resolveFrom(ctx.cwd, '@quiesco/ui');
    if (entry === null) return null;
    const module = (await import(pathToFileURL(entry).href)) as UiModule;
    const staticDir = path.join(path.dirname(entry), 'web');
    return { module, staticDir: ctx.exists(path.join(staticDir, 'index.html')) ? staticDir : null };
  },
  loadConfig: defaultTestDeps.loadConfig,
  listTests,
  untilInterrupted: (ctx) => new Promise<void>((resolve) => void ctx.onInterrupt(async () => resolve())),
};

function openBrowser(ctx: CliContext, url: string): void {
  const [command, args] = ctx.platform === 'darwin' ? ['open', [url]] : ctx.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  void ctx.exec(command as string, args as string[]).catch(() => undefined);
}

export async function uiCommand(args: readonly string[], ctx: CliContext, deps: UiDeps = defaultUiDeps): Promise<number> {
  if (args.includes('-h') || args.includes('--help')) {
    ctx.out(UI_HELP);
    return 0;
  }
  const p = takeOption(args, '--platform');
  const r = takeOption(p.rest, '--runner');
  const w = takeOption(r.rest, '--workers');
  const portOpt = takeOption(w.rest, '--port');
  const noOpen = takeFlag(portOpt.rest, '--no-open');
  const rest = noOpen.rest.filter((a) => a !== '--');
  const platform = parsePlatform(p.value) ?? parsePlatform(ctx.env['QUIESCO_PLATFORM']);
  if (platform === undefined) {
    ctx.err('quiesco ui: choose a platform with --platform ios|android|web (or set QUIESCO_PLATFORM). See quiesco ui --help.');
    return 2;
  }
  const runner = r.value ?? projectRunner(ctx);
  if (!isRunner(runner)) {
    ctx.err(`quiesco ui: unknown runner "${runner}" (cucumber, jest or vitest).`);
    return 2;
  }
  const workers = w.value !== undefined ? Number(w.value) : undefined;
  if (workers !== undefined && (!Number.isInteger(workers) || workers < 1)) {
    ctx.err(`quiesco ui: --workers takes a whole number ≥ 1 (got "${w.value}").`);
    return 2;
  }
  const port = portOpt.value !== undefined ? Number(portOpt.value) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    ctx.err(`quiesco ui: --port takes a port number (got "${portOpt.value}").`);
    return 2;
  }

  const ui = await deps.loadUi(ctx);
  if (ui === null) {
    ctx.err('quiesco ui: @quiesco/ui is not installed in this project. Install it: npm i -D @quiesco/ui');
    return 1;
  }
  const config = await deps.loadConfig(ctx.cwd, ctx.env);
  let devServer;
  try {
    devServer = config === null ? null : await ensureDevServer(ctx, config, platform);
  } catch (e) {
    ctx.err(`quiesco ui: ${(e as Error).message}`);
    return 1;
  }
  const spec = RUNNERS[runner];
  const base = [...spec.command, ...(workers !== undefined ? spec.workers(workers) : []), ...(runner === 'cucumber' ? cucumberFormatArgs(ctx) : []), ...rest];
  try {
    const server = await ui.module.startUiServer({
      cwd: ctx.cwd,
      runner,
      platform,
      artifactsDir: path.resolve(ctx.cwd, config?.artifacts?.dir ?? 'artifacts'),
      staticDir: ui.staticDir,
      ...(port !== undefined ? { port } : {}),
      listTests: () => deps.listTests({ runner, cwd: ctx.cwd, args: rest, env: ctx.env }),
      // npx runs the project's own runner; the chosen tests go last (after the user's arguments).
      startRun: (targetArgs, env, onOutput) => ui.module.spawnRun('npx', [...base, ...targetArgs], { cwd: ctx.cwd, env: { ...ctx.env, QUIESCO_PLATFORM: platform, ...devServer?.env, ...env }, onOutput }),
    });
    ctx.out(`quiesco ui: ${server.url}`);
    ctx.out('quiesco ui: Ctrl-C stops it.');
    if (!noOpen.present && ctx.interactive) openBrowser(ctx, server.url);
    await deps.untilInterrupted(ctx);
    await server.close();
    return 0;
  } finally {
    await devServer?.stop();
  }
}
