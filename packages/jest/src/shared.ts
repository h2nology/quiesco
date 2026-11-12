/**
 * The process's one Lifecycle. The test environment module is loaded once per process (outside the test
 * files' sandboxes), so this module state outlives each test file (findings 6.10 batch B).
 *
 * Parallel runs (Phase 6.12, findings 6.12 batch A): with maxWorkers > 1 every Jest worker process has its
 * own session (its own device). Jest ends a worker with SIGTERM and kills it about 0.5 s later, so the
 * session's async dispose never finishes there: the worker kills the session's child processes
 * synchronously instead, and writes their pids to a registry file that globalTeardown (in the main
 * process) sweeps as a backstop. In-band runs close the session from globalTeardown as before.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Lifecycle, killChildProcessesSync, trackedChildPids } from '@quiesco/core';
import type { WorkerInfo } from '@quiesco/core';

let lifecycle: Lifecycle | null = null;
let starting: Promise<Lifecycle> | null = null;

/** Where workers of the Jest run with main process `mainPid` register their child processes. */
export function registryDir(mainPid: number, tmp = os.tmpdir()): string {
  return path.join(tmp, `quiesco-jest-${mainPid}`);
}

/** Whether this is a Jest worker process (forked with IPC), not the main process running in band. */
export function inWorkerProcess(): boolean {
  return typeof process.send === 'function' && process.env['JEST_WORKER_ID'] !== undefined;
}

let exitHooked = false;

/**
 * jest-worker's "end" message to a worker process (CHILD_MESSAGE_END, jest-worker 29 and 30). On it the
 * worker only stops listening and waits for its event loop to drain, which an open session never lets
 * happen: about 0.5 s later Jest sends SIGTERM and reports "A worker process has failed to exit
 * gracefully" (findings 6.12).
 */
export const JEST_CHILD_MESSAGE_END = 2;

/** How long a worker's session may take to close before the worker exits anyway (Jest kills at ~0.5 s). */
const END_BUDGET_MS = 400;

/** In a worker process: close the session when Jest ends the worker, and never leave its children behind. */
function hookWorkerExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.on('message', (m: unknown) => {
    if (Array.isArray(m) && m[0] === JEST_CHILD_MESSAGE_END) void endWorker();
  });
  process.once('SIGTERM', () => {
    killChildProcessesSync();
    process.exit(0);
  });
  process.once('exit', () => killChildProcessesSync());
}

/** Close the session within the budget, then end the children left and the process. */
async function endWorker(): Promise<void> {
  const l = lifecycle;
  lifecycle = null;
  await Promise.race([l?.afterAll().catch(() => undefined), new Promise((r) => setTimeout(r, END_BUDGET_MS).unref())]);
  killChildProcessesSync();
  process.exit(0);
}

/** Write this worker's live child pids where globalTeardown finds them. */
export function registerChildren(dir = registryDir(process.ppid)): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify(trackedChildPids()));
  } catch {
    // best effort: the synchronous kill on SIGTERM is the main mechanism
  }
}

/** Starts the session once; a start that failed fails every later test file at once (no new attempt). */
export function startShared(worker: WorkerInfo): Promise<Lifecycle> {
  starting ??= (async () => {
    const worked = inWorkerProcess();
    if (worked) hookWorkerExit();
    const l = new Lifecycle({ worker });
    await l.beforeAll();
    lifecycle = l;
    if (worked) registerChildren();
    return l;
  })();
  return starting;
}

/** globalTeardown: close an in-band session, then kill what the workers' registries still list. */
export async function disposeShared(dir = registryDir(process.pid)): Promise<number> {
  const l = lifecycle;
  lifecycle = null;
  starting = null;
  await l?.afterAll();
  return sweepRegistry(dir);
}

/** Kill registered child pids that are still alive; returns how many were. Removes the registry. */
export function sweepRegistry(dir: string, kill: (pid: number, signal?: NodeJS.Signals | 0) => void = process.kill.bind(process)): number {
  const read = <T>(f: () => T, fallback: T): T => {
    try {
      return f();
    } catch {
      return fallback;
    }
  };
  const files = read(() => fs.readdirSync(dir).filter((f) => f.endsWith('.json')), null);
  if (files === null) return 0;
  let n = 0;
  for (const f of files) {
    const pids: unknown = read(() => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as unknown, []);
    for (const pid of Array.isArray(pids) ? pids : []) {
      if (typeof pid !== 'number') continue;
      try {
        kill(pid, 0);
        kill(pid, 'SIGKILL');
        n++;
      } catch {
        // already gone
      }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return n;
}
