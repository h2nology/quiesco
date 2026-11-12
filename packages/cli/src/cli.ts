/** Command dispatch for the `quiesco` binary (requirements.md §6.12). */
import { createRequire } from 'node:module';

import { devicesCommand } from './commands/devices.js';
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
  test     Run the tests with cucumber-js (or --runner jest|vitest); other arguments go to the runner unchanged
             --platform ios|android|web   --workers N (N devices in parallel)
  doctor   Check the tools and the project setup
             --platform ios|android|web
  tree     Print the element tree of the running app (to find testIDs)
             --launch (boot the device and launch the app first)   --json   --timeout <ms>   --platform …
  devices  List the simulators / AVDs Quiesco created for parallel workers
             --prune (shut them down and delete them)

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
      case 'devices':
        return await devicesCommand(args, ctx);
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
