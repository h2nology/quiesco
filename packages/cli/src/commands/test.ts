/**
 * `quiesco test [--platform ios|android|web] [--runner cucumber|jest|vitest] [runner arguments…]`
 * (requirements.md §6.12, Phase 6.10): sets QUIESCO_PLATFORM and runs the project's test runner with the
 * remaining arguments unchanged. Default runner: cucumber-js.
 */
import type { CliContext } from '../context.js';
import { parsePlatform, takeOption } from '../context.js';

const RUNNERS = {
  cucumber: { command: ['cucumber-js'], parallel: ['--parallel'] },
  // `jest` reads jest.config.*; serial runs are checked again by @quiesco/jest.
  jest: { command: ['jest'], parallel: ['-w', '--maxWorkers'] },
  vitest: { command: ['vitest', 'run'], parallel: ['--fileParallelism', '--maxWorkers'] },
} as const;
type Runner = keyof typeof RUNNERS;

function isRunner(v: string | undefined): v is Runner {
  return v !== undefined && Object.hasOwn(RUNNERS, v);
}

export async function testCommand(args: readonly string[], ctx: CliContext): Promise<number> {
  const p = takeOption(args, '--platform');
  const r = takeOption(p.rest, '--runner');
  const rest = r.rest;
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
  const parallel = rest.find((a) => spec.parallel.some((f) => a === f || a.startsWith(`${f}=`)));
  if (parallel !== undefined) {
    ctx.err(`quiesco test: Quiesco runs tests on one device at a time; ${parallel} is not supported.`);
    return 2;
  }
  // npx runs the project's own runner (node_modules/.bin), the one the tests import.
  return ctx.run('npx', [...spec.command, ...rest], { cwd: ctx.cwd, env: { ...ctx.env, QUIESCO_PLATFORM: platform } });
}
