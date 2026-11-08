/** Public app-side API (requirements.md §6.5, §6.6). Shared by index.ts and the production stub. */

/** A backdoor: test-only function the host can call. Arguments and result must be JSON-serializable. */
export type Backdoor = (...args: never[]) => unknown;

/** Clears one persistent store during soft reset (AsyncStorage, MMKV, SecureStore, ...). */
export interface StorageAdapter {
  name: string;
  clear(): void | Promise<void>;
}

export interface QuiescoApi {
  /** Register a backdoor under `name` (re-registering replaces it). Returns an unregister function. */
  backdoor(name: string, fn: Backdoor): () => void;
  /** Hook run on every soft reset, after storage is cleared and before the app remounts. */
  onReset(hook: () => void | Promise<void>): () => void;
  /** Extra store to clear on soft reset. AsyncStorage (native) / web storage are cleared built-in. */
  registerStorage(adapter: StorageAdapter): () => void;
  /**
   * Index of the parallel test worker driving this app (0 when tests run serially), for per-worker
   * resources such as a mock backend on `3001 + workerIndex`. `null` until the host has connected
   * (it connects before the first test command) and always in production builds.
   */
  workerIndex(): number | null;
}
