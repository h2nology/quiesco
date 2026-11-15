/**
 * The Quiesco packages in a project and their installed versions (issue #17): `init` installs the
 * version of the CLI that runs it and checks what landed; `doctor` checks that they agree.
 */
import path from 'node:path';

import type { CliContext } from './context.js';

/** The CLI's subcommands, as `quiesco <command>` in package.json scripts may name them. */
export const CLI_COMMANDS = ['init', 'build', 'test', 'ui', 'list', 'doctor', 'tree', 'devices'] as const;

/** `quiesco` and `@quiesco/*`: released together, always the same version. */
export const isQuiescoPackage = (name: string): boolean => name === 'quiesco' || name.startsWith('@quiesco/');

/**
 * The version of `name` that code in `dir` loads: `node_modules/<name>/package.json` in `dir` or the
 * nearest parent that has one (hoisted workspaces). Read directly rather than resolved, because not
 * every package exports `./package.json`. null when it is not installed.
 */
export function installedVersion(ctx: CliContext, name: string, dir: string = ctx.cwd): string | null {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const text = ctx.readFile(path.join(d, 'node_modules', name, 'package.json'));
    if (text !== null) {
      try {
        const version = (JSON.parse(text) as { version?: unknown }).version;
        return typeof version === 'string' ? version : null;
      } catch {
        return null;
      }
    }
    if (path.dirname(d) === d) return null;
  }
}

/** Every `quiesco <command>` in the scripts (not `@quiesco/…`, `quiesco.config`, `quiesco --version`). */
export function scriptCommands(scripts: Record<string, string> | undefined): { script: string; command: string }[] {
  const found: { script: string; command: string }[] = [];
  for (const [script, line] of Object.entries(scripts ?? {})) {
    for (const m of line.matchAll(/(?:^|[^\w@/.-])quiesco\s+([a-z][\w:-]*)/g)) found.push({ script, command: m[1] as string });
  }
  return found;
}
