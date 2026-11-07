import type { QuiescoApi } from './api-types';
import { getRuntime } from './singleton';

/** App-side API: backdoors, reset hooks and extra storage adapters. */
export const quiesco: QuiescoApi = {
  backdoor: (name, fn) => getRuntime().backdoors.register(name, fn),
  onReset: (hook) => getRuntime().resets.onReset(hook),
  registerStorage: (adapter) => getRuntime().resets.registerStorage(adapter),
};
