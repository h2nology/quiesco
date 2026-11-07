/**
 * Soft reset (requirements.md §6.5):
 * 1. clear persistent storage (built-in adapters for the platform + adapters registered by the app),
 * 2. run the app's onReset hooks (in registration order),
 * 3. remount the whole app by changing QuiescoRoot's key,
 * 4. (the runtime then waits for idle).
 * A failing step aborts the reset with RESET_FAILED naming the step.
 */
import type { StorageAdapter } from '../api-types';
import { QuiescoError } from '../errors';

export class ResetManager {
  private readonly hooks: (() => void | Promise<void>)[] = [];
  private readonly storages: StorageAdapter[] = [];

  constructor(private readonly builtInStorage: () => StorageAdapter[]) {}

  onReset(hook: () => void | Promise<void>): () => void {
    if (typeof hook !== 'function') throw new TypeError('quiesco.onReset(hook): hook must be a function');
    this.hooks.push(hook);
    return () => {
      const i = this.hooks.indexOf(hook);
      if (i >= 0) this.hooks.splice(i, 1);
    };
  }

  registerStorage(adapter: StorageAdapter): () => void {
    if (adapter == null || typeof adapter.clear !== 'function') throw new TypeError('quiesco.registerStorage(adapter): adapter.clear must be a function');
    this.storages.push(adapter);
    return () => {
      const i = this.storages.indexOf(adapter);
      if (i >= 0) this.storages.splice(i, 1);
    };
  }

  /** Steps 1–3. `remount` is null when QuiescoRoot is not mounted. */
  async run(remount: (() => void) | null): Promise<void> {
    for (const s of [...this.builtInStorage(), ...this.storages]) {
      await step(`storage:${s.name}`, () => s.clear());
    }
    let i = 0;
    for (const hook of [...this.hooks]) {
      await step(`onReset#${i++}`, hook);
    }
    if (remount === null) {
      throw new QuiescoError('RESET_FAILED', 'Soft reset failed at remount: QuiescoRoot is not mounted', { step: 'remount', message: 'QuiescoRoot is not mounted' });
    }
    await step('remount', remount);
  }
}

async function step(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new QuiescoError('RESET_FAILED', `Soft reset failed at ${name}: ${message}`, { step: name, message });
  }
}
