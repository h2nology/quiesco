/** Idle tracker contract (requirements.md §6.2). */
export interface IdleTracker {
  readonly name: string;
  isIdle(): boolean;
  /** Human-readable reasons, e.g. `GET https://api.example.com/todos (1200ms)`. Empty when idle. */
  describeBusy(): string[];
  install(): void;
  uninstall(): void;
  /** Optional: called when a waitForIdle starts / ends (frame-stable only samples while waiting). */
  beginWait?(): void;
  endWait?(): void;
}

/** Timer functions the agent uses for its own scheduling. They must NOT be the tracked ones. */
export interface Clock {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  now(): number;
}

type AnyFn = (...args: never[]) => unknown;

/** Replace `obj[key]` and return a function that restores it (only if nobody replaced it since). */
export function patch<T extends object, K extends keyof T>(obj: T, key: K, make: (original: T[K]) => T[K]): () => void {
  const original = obj[key];
  const replacement = make(original);
  obj[key] = replacement;
  return () => {
    if (obj[key] === replacement) obj[key] = original;
  };
}

export function isFunction(v: unknown): v is AnyFn {
  return typeof v === 'function';
}

/**
 * Real timers captured when this module is first evaluated, i.e. before any tracker patches the
 * globals (the agent is the first import of the app entry).
 */
const g = globalThis as unknown as {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};
const realSetTimeout = g.setTimeout;
const realClearTimeout = g.clearTimeout;
export const realClock: Clock = {
  setTimeout: (cb, ms) => realSetTimeout.call(globalThis, cb, ms),
  clearTimeout: (id) => realClearTimeout.call(globalThis, id),
  now: () => Date.now(),
};
