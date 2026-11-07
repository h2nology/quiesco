/**
 * App → host events (requirements.md §7): console output as `log`, uncaught errors as `error`
 * (the current step fails immediately on the host).
 * - React Native: wraps `ErrorUtils.setGlobalHandler` (fatal → `redbox`, otherwise `uncaught`).
 * - Browsers: `error` / `unhandledrejection` window events.
 * Both are feature-detected; nothing here branches on the platform name.
 * Native unhandled promise rejections are only reported by RN in __DEV__ (as LogBox warnings) and are
 * not forwarded yet.
 */
import type { AgentEvents, LogLevel } from '@quiesco/protocol';

type Notify = <E extends keyof AgentEvents>(event: E, params: AgentEvents[E]) => void;

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const CONSOLE_METHODS: Record<string, LogLevel> = { debug: 'debug', log: 'info', info: 'info', warn: 'warn', error: 'error' };

interface ErrorUtilsLike {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}
interface EventTargetLike {
  addEventListener(type: string, listener: (ev: unknown) => void): void;
  removeEventListener(type: string, listener: (ev: unknown) => void): void;
}

export interface EventForwarderOptions {
  notify: Notify;
  target?: Record<string, unknown>;
  now?: () => number;
}

function formatArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

function errorParts(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error) return e.stack === undefined ? { message: e.message } : { message: e.message, stack: e.stack };
  return { message: formatArg(e) };
}

export class EventForwarder {
  private minLevel = LEVELS.warn;
  private readonly restores: (() => void)[] = [];
  private readonly target: Record<string, unknown>;
  private readonly now: () => number;
  private forwarding = false;

  constructor(private readonly options: EventForwarderOptions) {
    this.target = options.target ?? (globalThis as unknown as Record<string, unknown>);
    this.now = options.now ?? Date.now;
  }

  setLevel(level: LogLevel | 'off'): void {
    this.minLevel = level === 'off' ? Number.POSITIVE_INFINITY : LEVELS[level];
  }

  install(): void {
    if (this.restores.length > 0) return;
    this.installConsole();
    this.installErrorUtils();
    this.installWindowEvents();
  }

  uninstall(): void {
    while (this.restores.length > 0) this.restores.pop()?.();
  }

  private send: Notify = (event, params) => {
    // Guard against recursion when sending itself logs (e.g. a failing socket warns).
    if (this.forwarding) return;
    this.forwarding = true;
    try {
      this.options.notify(event, params);
    } catch {
      // never break the app's console
    } finally {
      this.forwarding = false;
    }
  };

  private installConsole(): void {
    const c = this.target['console'] as Record<string, unknown> | undefined;
    if (c === undefined) return;
    for (const [method, level] of Object.entries(CONSOLE_METHODS)) {
      const original = c[method];
      if (typeof original !== 'function') continue;
      const self = this;
      const wrapped = function (this: unknown, ...args: unknown[]) {
        if (LEVELS[level] >= self.minLevel) self.send('log', { level, message: args.map(formatArg).join(' '), timestamp: self.now() });
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
      c[method] = wrapped;
      this.restores.push(() => {
        if (c[method] === wrapped) c[method] = original;
      });
    }
  }

  private installErrorUtils(): void {
    const eu = this.target['ErrorUtils'] as ErrorUtilsLike | undefined;
    if (eu === undefined || typeof eu.setGlobalHandler !== 'function') return;
    const previous = eu.getGlobalHandler();
    const handler = (error: unknown, isFatal?: boolean): void => {
      this.send('error', { kind: isFatal === true ? 'redbox' : 'uncaught', ...errorParts(error), timestamp: this.now() });
      previous(error, isFatal);
    };
    eu.setGlobalHandler(handler);
    this.restores.push(() => {
      if (eu.getGlobalHandler() === handler) eu.setGlobalHandler(previous);
    });
  }

  private installWindowEvents(): void {
    const w = this.target['window'] as EventTargetLike | undefined;
    if (w === undefined || typeof w.addEventListener !== 'function') return;
    const onError = (ev: unknown): void => {
      const e = ev as { error?: unknown; message?: string };
      this.send('error', { kind: 'uncaught', ...errorParts(e.error ?? e.message), timestamp: this.now() });
    };
    const onRejection = (ev: unknown): void => {
      this.send('error', { kind: 'unhandledRejection', ...errorParts((ev as { reason?: unknown }).reason), timestamp: this.now() });
    };
    w.addEventListener('error', onError);
    w.addEventListener('unhandledrejection', onRejection);
    this.restores.push(() => {
      w.removeEventListener('error', onError);
      w.removeEventListener('unhandledrejection', onRejection);
    });
  }
}
