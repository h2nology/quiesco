/**
 * Run the test runner with the progress bar (P3): a run-events socket the runner's Quiesco reporter
 * connects to (QUIESCO_EVENTS), the runner's output piped through so the bar stays on the last line.
 */
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { RunEventServer, RunState } from '@quiesco/core';

import type { CliContext, Terminal } from '../context.js';
import { renderBar } from './render.js';
import { StickyTerminal } from './sticky.js';

export type RunnerName = 'cucumber' | 'jest' | 'vitest';

/** Redraw at most this often for events; the clock ticks once a second. */
const FRAME_MS = 80;

/**
 * Whether to show the bar: a terminal, not CI, not turned off (`--no-progress`, QUIESCO_PROGRESS=0).
 */
export function progressWanted(ctx: CliContext, noProgressFlag: boolean): ctx is CliContext & { terminal: Terminal } {
  if (noProgressFlag || ctx.terminal === null) return false;
  const env = ctx.env;
  if (env['QUIESCO_PROGRESS'] === '0' || env['QUIESCO_PROGRESS'] === 'false') return false;
  const ci = env['CI'];
  return ci === undefined || ci === '' || ci === '0' || ci === 'false';
}

/**
 * The cucumber-js arguments that add Quiesco's events formatter, from the project's own
 * @quiesco/cucumber; [] when it is not installed. The file target keeps the user's stdout formatter
 * (a format without one would replace it).
 */
export function cucumberFormatArgs(ctx: CliContext): string[] {
  const file = ctx.resolveFrom(ctx.cwd, '@quiesco/cucumber/events');
  if (file === null) return [];
  const url = pathToFileURL(file).href;
  // Windows: a temp file (cucumber creates the target's directory, which fails for the null device).
  const target = ctx.platform === 'win32' ? path.join(os.tmpdir(), `quiesco-events-${process.pid}.out`) : '/dev/null';
  const descriptor = `"${url}":"${target}"`;
  // Through cmd.exe (Windows runs npx with a shell) the quotes must survive the argument parsing.
  return ['--format', ctx.platform === 'win32' ? `"${descriptor.replaceAll('"', '\\"')}"` : descriptor];
}

const HINTS: Record<RunnerName, string> = {
  cucumber: "quiesco: no test progress was received. Install @quiesco/cucumber in this project (quiesco test adds its formatter by itself).",
  vitest: "quiesco: no test progress was received. Add quiescoPlugin() to your Vitest config: `import { quiesco, quiescoPlugin } from '@quiesco/vitest/config'` and `plugins: [quiescoPlugin()]`.",
  jest: "quiesco: no test progress was received. Your Jest config replaces the preset's reporters: add '@quiesco/jest/reporter' to `reporters` (next to 'default').",
};

export interface ProgressRun {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  runner: RunnerName;
}

export async function runWithProgress(ctx: CliContext & { terminal: Terminal }, run: ProgressRun): Promise<number> {
  const term = ctx.terminal;
  const state = new RunState();
  const sticky = new StickyTerminal({ write: term.stdout, columns: term.columns });
  const draw = () => sticky.setBar(renderBar(state, { width: term.columns(), color: term.color }));
  let frame: NodeJS.Timeout | null = null;
  const schedule = () => {
    frame ??= setTimeout(() => {
      frame = null;
      draw();
    }, FRAME_MS);
  };
  const server = new RunEventServer({
    onEvent: (event) => {
      state.apply(event);
      schedule();
    },
  });
  await server.listen();
  const clock = setInterval(draw, 1000);
  clock.unref();
  const offInterrupt = term.onInterrupt(() => sticky.stop());
  draw();

  const env: NodeJS.ProcessEnv = { ...run.env, ...server.env() };
  // The runner's output is a pipe now: keep its colors and width as on the terminal.
  if (term.color && env['FORCE_COLOR'] === undefined && env['NO_COLOR'] === undefined) env['FORCE_COLOR'] = '1';
  if (env['COLUMNS'] === undefined) env['COLUMNS'] = String(term.columns());

  let code: number;
  try {
    code = await ctx.runPiped(run.command, run.args, { cwd: ctx.cwd, env, onStdout: (c) => sticky.output(c, term.stdout), onStderr: (c) => sticky.output(c, term.stderr) });
    await server.drain();
  } finally {
    clearInterval(clock);
    if (frame !== null) clearTimeout(frame);
    offInterrupt();
    await server.close();
  }
  state.runnerExited(code);
  const received = server.hellos.length > 0;
  sticky.stop(received ? renderBar(state, { width: term.columns(), color: term.color }) : undefined);
  if (!received) ctx.err(HINTS[run.runner]);
  return code;
}
