/**
 * `quiesco test [--platform ios|android|web] [--runner cucumber|jest|vitest] [--workers N] [runner arguments…]`
 * (requirements.md §6.12, Phase 6.10): sets QUIESCO_PLATFORM and runs the project's test runner with the
 * remaining arguments unchanged. Default runner: cucumber-js. `--workers N` (Phase 6.12) runs N workers,
 * each on its own device, with the runner's own flags; those flags can also be passed directly.
 * Everything after a `--` goes to the runner as-is, and the `--` itself is dropped (issue #7): cucumber-js
 * would read every argument after it as a path.
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

export const TEST_HELP = `Usage: quiesco test [options] [runner arguments…]

Sets QUIESCO_PLATFORM and runs the project's test runner. Arguments Quiesco does not know go to the runner
unchanged; everything after \`--\` goes to the runner as well (the \`--\` itself is dropped).

Options:
  --platform ios|android|web     Platform to test (or set QUIESCO_PLATFORM)
  --runner cucumber|jest|vitest  Test runner (default: cucumber, i.e. cucumber-js)
  --workers N                    Run N workers, each on a device of its own
  -h, --help                     Show this help (\`quiesco test -- --help\` shows the runner's)

Examples:
  quiesco test --platform ios --tags @smoke
  quiesco test --platform web features/login.feature
  quiesco test --platform android --name "Add a todo"
  quiesco test --platform web -- --tags @debug
  quiesco test --platform ios --runner vitest --config vitest.e2e.config.mts`;

function isRunner(v: string | undefined): v is Runner {
  return v !== undefined && Object.hasOwn(RUNNERS, v);
}

export async function testCommand(args: readonly string[], ctx: CliContext): Promise<number> {
  // Quiesco reads its own options only before a `--`; what follows goes to the runner untouched.
  const dashDash = args.indexOf('--');
  const own = dashDash === -1 ? args : args.slice(0, dashDash);
  const passThrough = dashDash === -1 ? [] : args.slice(dashDash + 1);
  if (own.includes('-h') || own.includes('--help')) {
    ctx.out(TEST_HELP);
    return 0;
  }
  const p = takeOption(own, '--platform');
  const r = takeOption(p.rest, '--runner');
  const w = takeOption(r.rest, '--workers');
  const rest = [...w.rest, ...passThrough];
  const platform = parsePlatform(p.value) ?? parsePlatform(ctx.env['QUIESCO_PLATFORM']);
  if (platform === undefined) {
    ctx.err('quiesco test: choose a platform with --platform ios|android|web (or set QUIESCO_PLATFORM). See quiesco test --help.');
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
