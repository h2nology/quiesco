/**
 * @quiesco/ui: the test UI behind `quiesco ui` — run tests from the browser and watch them live.
 * The CLI loads it; it is not meant to be used directly.
 */
export { startUiServer } from './server.js';
export type { UiServer, UiServerOptions } from './server.js';
export { spawnRun } from './spawn.js';
export type { RunHandle, SpawnRunOptions } from './spawn.js';
export { targetArgs } from './targets.js';
export type { RunTarget } from './targets.js';
export type { ClientMessage, RunningInfo, ServerMessage, UiInfo } from './messages.js';
