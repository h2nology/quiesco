import { After, AfterAll, Before, BeforeAll, Status, setDefaultTimeout, setWorldConstructor } from '@cucumber/cucumber';

import { Lifecycle, tagLevels } from './lifecycle.js';
import type { LifecycleOptions } from './lifecycle.js';
import { QuiescoWorld, bindLifecycle } from './world.js';

export interface RegisterOptions extends LifecycleOptions {
  /** Use your own World (must extend QuiescoWorld). Default QuiescoWorld. */
  world?: typeof QuiescoWorld;
  /** Default step timeout. Each driver call has its own sync timeout; this caps a whole step. Default 60 s. */
  stepTimeoutMs?: number;
  /** BeforeAll timeout: booting an emulator can take minutes. Default 10 min. */
  setupTimeoutMs?: number;
}

/** Register the World and the lifecycle hooks with cucumber-js. Call once, from a support file. */
export function registerQuiesco(options: RegisterOptions = {}): Lifecycle {
  const lifecycle = new Lifecycle(options);
  bindLifecycle(lifecycle);
  setWorldConstructor(options.world ?? QuiescoWorld);
  setDefaultTimeout(options.stepTimeoutMs ?? 60_000);

  BeforeAll({ name: 'quiesco: start session', timeout: options.setupTimeoutMs ?? 600_000 }, () => lifecycle.beforeAll());
  Before({ name: 'quiesco: reset app' }, ({ pickle, gherkinDocument }) => lifecycle.before(tagLevels(pickle.tags, gherkinDocument), pickle.name));
  After({ name: 'quiesco: evidence' }, async function (this: QuiescoWorld, { pickle, result }) {
    const failed = result !== undefined && result.status !== Status.PASSED && result.status !== Status.SKIPPED;
    for (const a of await lifecycle.after({ tags: pickle.tags.map((t) => t.name), failed })) {
      const opts = a.fileName !== undefined ? { mediaType: a.mediaType, fileName: a.fileName } : { mediaType: a.mediaType };
      if (typeof a.data === 'string') this.attach(a.data, opts);
      else this.attach(a.data, opts);
    }
  });
  AfterAll({ name: 'quiesco: stop session', timeout: 120_000 }, () => lifecycle.afterAll());
  return lifecycle;
}
