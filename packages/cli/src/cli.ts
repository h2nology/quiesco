/** Command dispatch for the `quiesco` binary (requirements.md §6.12). */
import { createRequire } from 'node:module';

import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { testCommand } from './commands/test.js';
import { treeCommand } from './commands/tree.js';
import type { CliContext } from './context.js';
import { defaultContext } from './context.js';

export const HELP = `Usage: quiesco <command> [options]

Commands:
  init     Set Quiesco up in this Expo project (dependencies, config plugin, Metro, entry, config, features)
             --platforms ios,android,web   --packages <dir> (install from tarballs)   --skip-install
  test     Run the features with cucumber-js; other arguments go to cucumber-js unchanged
             --platform ios|android|web
  doctor   Check the tools and the project setup
             --platform ios|android|web
  tree     Print the element tree of the running app (to find testIDs)
             --launch (boot the device and launch the app first)   --json   --timeout <ms>   --platform …

Options:
  -h, --help     Show this help
  -v, --version  Show the version`;

function version(): string {
  const require = createRequire(import.meta.url);
  return (require('../package.json') as { version: string }).version;
}

export async function main(argv: readonly string[], ctx: CliContext = defaultContext()): Promise<number> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case 'init':
        return await initCommand(args, ctx);
      case 'test':
        return await testCommand(args, ctx);
      case 'doctor':
        return await doctorCommand(args, ctx);
      case 'tree':
        return await treeCommand(args, ctx);
      case '-v':
      case '--version':
        ctx.out(version());
        return 0;
      case undefined:
      case '-h':
      case '--help':
      case 'help':
        ctx.out(HELP);
        return 0;
      default:
        ctx.err(`quiesco: unknown command "${command}"\n\n${HELP}`);
        return 2;
    }
  } catch (e) {
    ctx.err(`quiesco ${command}: ${(e as Error).message}`);
    return 1;
  }
}
