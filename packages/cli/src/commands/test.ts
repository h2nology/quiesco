/**
 * `quiesco test [--platform ios|android|web] [cucumber-js arguments…]` (requirements.md §6.12): sets
 * QUIESCO_PLATFORM and runs the project's cucumber-js with the remaining arguments unchanged.
 */
import type { CliContext } from '../context.js';
import { parsePlatform, takeOption } from '../context.js';

export async function testCommand(args: readonly string[], ctx: CliContext): Promise<number> {
  const { value, rest } = takeOption(args, '--platform');
  const platform = parsePlatform(value) ?? parsePlatform(ctx.env['QUIESCO_PLATFORM']);
  if (platform === undefined) {
    ctx.err('quiesco test: choose a platform with --platform ios|android|web (or set QUIESCO_PLATFORM).');
    return 2;
  }
  if (rest.includes('--parallel')) {
    ctx.err('quiesco test: Quiesco runs scenarios on one device at a time; --parallel is not supported.');
    return 2;
  }
  // npx runs the project's own cucumber-js (node_modules/.bin), the one the step definitions import.
  return ctx.run('npx', ['cucumber-js', ...rest], { cwd: ctx.cwd, env: { ...ctx.env, QUIESCO_PLATFORM: platform } });
}
