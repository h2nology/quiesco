/**
 * `quiesco test [--platform ios|android|web] [--runner cucumber|jest|vitest] [--workers N] [runner arguments…]`
 * (requirements.md §6.12, Phase 6.10): sets QUIESCO_PLATFORM and runs the project's test runner with the
 * remaining arguments unchanged. Default runner: cucumber-js. `--workers N` (Phase 6.12) runs N workers,
 * each on its own device, with the runner's own flags; those flags can also be passed directly.
 */
import type { CliContext } from '../context.js';
import { parsePlatform, takeOption } from '../context.js';

const RUNNERS = {
  cucumber: { command: ['cucumber-js'], workers: (n: number) => (n > 1 ? ['--parallel', String(n)] : []) },
  // `jest` reads jest.config.*.
  jest: { command: ['jest'], workers: (n: number) => ['--maxWorkers', String(n)] },
  vitest: { command: ['vitest', 'run'], workers: (n: number) => (n > 1 ? ['--fileParallelism', '--maxWorkers', String(n)] : ['--no-file-parallelism', '--maxWorkers', '1']) },
} as const;
type Runner = keyof typeof RUNNERS;

function isRunner(v: string | undefined): v is Runner {
  return v !== undefined && Object.hasOwn(RUNNERS, v);
}

export async function testCommand(args: readonly string[], ctx: CliContext): Promise<number> {
  const p = takeOption(args, '--platform');
  const r = takeOption(p.rest, '--runner');
  const w = takeOption(r.rest, '--workers');
  const rest = w.rest;
  const platform = parsePlatform(p.value) ?? parsePlatform(ctx.env['QUIESCO_PLATFORM']);
  if (platform === undefined) {
    ctx.err('quiesco test: choose a platform with --platform ios|android|web (or set QUIESCO_PLATFORM).');
    return 2;
  }
  const runner = r.value ?? 'cucumber';
  if (!isRunner(runner)) {
    ctx.err(`quiesco test: unknown runner "${runner}" (cucumber, jest or vitest).`);
    return 2;
  }
  const spec = RUNNERS[runner];
  let workerArgs: string[] = [];
  if (w.value !== undefined) {
    const n = Number(w.value);
    if (!Number.isInteger(n) || n < 1) {
      ctx.err(`quiesco test: --workers takes a whole number ≥ 1 (got "${w.value}").`);
      return 2;
    }
    workerArgs = [...spec.workers(n)];
  }
  // npx runs the project's own runner (node_modules/.bin), the one the tests import.
  return ctx.run('npx', [...spec.command, ...workerArgs, ...rest], { cwd: ctx.cwd, env: { ...ctx.env, QUIESCO_PLATFORM: platform } });
}
