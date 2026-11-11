/**
 * The run's one Lifecycle. The test environment module is loaded once per process (outside the test
 * files' sandboxes), so this module state outlives each test file; globalTeardown imports the same
 * module and closes the session (findings 6.10 batch B).
 */
import { Lifecycle } from '@quiesco/core';

let lifecycle: Lifecycle | null = null;
let starting: Promise<Lifecycle> | null = null;

/** Starts the session once; a start that failed fails every later test file at once (no new attempt). */
export function startShared(checkSerial: () => string | null): Promise<Lifecycle> {
  starting ??= (async () => {
    const l = new Lifecycle({ checkSerial });
    await l.beforeAll();
    lifecycle = l;
    return l;
  })();
  return starting;
}

export async function disposeShared(): Promise<void> {
  const l = lifecycle;
  lifecycle = null;
  starting = null;
  await l?.afterAll();
}
