/**
 * The test runners Quiesco drives, and which one a project uses. `quiesco init` asks for one (Vitest by
 * default) and installs its packages; `quiesco test` / `ui` / `list` without `--runner` use the one whose
 * Quiesco package the project has.
 */
import path from 'node:path';

import type { CliContext } from './context.js';

/** In the order `quiesco init` offers them: the first is the default. */
export const RUNNER_NAMES = ['vitest', 'jest', 'cucumber'] as const;
export type RunnerName = (typeof RUNNER_NAMES)[number];

export function isRunnerName(v: string | undefined): v is RunnerName {
  return v !== undefined && (RUNNER_NAMES as readonly string[]).includes(v);
}

/** The devDependencies each runner needs: Quiesco's integration and the runner itself. */
export const RUNNER_PACKAGES: Record<RunnerName, readonly string[]> = {
  vitest: ['@quiesco/vitest', 'vitest'],
  jest: ['@quiesco/jest', 'jest'],
  cucumber: ['@quiesco/cucumber', '@cucumber/cucumber'],
};

export const RUNNER_LABELS: Record<RunnerName, string> = {
  vitest: 'Vitest (recommended): tests in TypeScript, app as a test fixture',
  jest: 'Jest: tests in JavaScript, app as the global quiesco.app',
  cucumber: 'Cucumber: Gherkin features with step definitions',
};

/**
 * The runner whose Quiesco package (@quiesco/vitest, @quiesco/jest, @quiesco/cucumber) is in package.json.
 * With none or several of them: cucumber, the default of Quiesco 0.6 and earlier (projects set up then
 * keep running the same way); `--runner` picks another.
 */
export function projectRunner(ctx: CliContext): RunnerName {
  const text = ctx.readFile(path.join(ctx.cwd, 'package.json'));
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try {
    pkg = text === null ? {} : (JSON.parse(text) as typeof pkg);
  } catch {
    // unreadable package.json: the default
  }
  const has = (name: string): boolean => pkg.dependencies?.[name] !== undefined || pkg.devDependencies?.[name] !== undefined;
  const found = RUNNER_NAMES.filter((r) => has(RUNNER_PACKAGES[r][0] as string));
  return found.length === 1 ? (found[0] as RunnerName) : 'cucumber';
}
