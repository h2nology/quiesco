/**
 * Messages between the `quiesco ui` server and the browser, over a WebSocket at `/ws` (JSON, one
 * message per frame). Types only: the web app imports them too.
 */
import type { RunStateSnapshot } from '@quiesco/core/run-state';
import type { RunEvent, RunnerName, TestList } from '@quiesco/protocol';

import type { RunTarget } from './targets.js';

export type { RunTarget };

export interface UiInfo {
  /** The project directory's name. */
  project: string;
  runner: RunnerName;
  platform: string;
  /** Version of @quiesco/ui. */
  version: string;
}

export type ServerMessage =
  /** First message on a connection, with everything needed to draw the page. */
  | { type: 'welcome'; info: UiInfo; list: TestList | null; listing: boolean; state: RunStateSnapshot; running: RunningInfo | null; output: string }
  /** Listing the tests started (`listing: true`) or finished (with the list). */
  | { type: 'list'; list: TestList | null; listing: boolean }
  /** A run event from the runner (apply it to the RunState). */
  | { type: 'event'; event: RunEvent }
  /** A run started (`running` set) or ended (`running: null`, the final state). */
  | { type: 'run'; running: RunningInfo | null; exitCode?: number; state?: RunStateSnapshot }
  /** The runner's own output (stdout / stderr). */
  | { type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'notice'; level: 'info' | 'error'; message: string };

export interface RunningInfo {
  target: RunTarget;
  /** The runner arguments chosen for the target. */
  args: string[];
  startedAt: number;
}

export type ClientMessage = { type: 'run'; target: RunTarget } | { type: 'cancel' } | { type: 'list' };
