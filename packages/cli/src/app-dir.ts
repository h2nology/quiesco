/**
 * Where the Expo app is (issue #54): the test project's directory, or `appDir` in quiesco.config (tests in
 * a package of their own: a monorepo, or `app/` and `e2e/` side by side). `--app-dir` overrides it.
 */
import path from 'node:path';

import type { CliContext } from './context.js';

/** The option the commands that work on the app take. */
export const APP_DIR_OPTION = '--app-dir';

/**
 * The context for the app: `ctx` itself when the app is the project directory, else a copy whose `cwd`
 * is the app's directory. `flag` (relative to the working directory) wins over `config.appDir`.
 */
export function appContext(ctx: CliContext, config: { appDir?: string } | null, flag?: string): CliContext {
  const dir = flag !== undefined ? path.resolve(ctx.cwd, flag) : config?.appDir !== undefined ? path.resolve(ctx.cwd, config.appDir) : ctx.cwd;
  return path.resolve(dir) === path.resolve(ctx.cwd) ? ctx : { ...ctx, cwd: dir };
}

/** How a path in the app is shown: relative to the working directory when near it, else absolute. */
export function inApp(ctx: CliContext, app: CliContext, file = ''): string {
  const abs = path.join(app.cwd, file);
  const rel = path.relative(ctx.cwd, abs);
  return rel === '' ? '.' : rel.split(path.sep).filter((p) => p === '..').length > 2 ? abs : rel;
}
