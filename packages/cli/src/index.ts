export { main, HELP } from './cli.js';
export type { CliContext, ExecResult } from './context.js';
export { formatTree } from './commands/tree.js';
export { runChecks } from './commands/doctor.js';
export type { CheckResult, CheckStatus } from './commands/doctor.js';
