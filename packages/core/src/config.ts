/**
 * `quiesco.config.ts` (requirements.md §6.13). Device names, API levels and viewports are always taken
 * from the user's config; nothing is hard-coded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_PORT, SyncDefaults } from '@quiesco/protocol';
import type { ActionMode, AgentConfig, GestureSlop, JsonValue, LogLevel, Platform, TrackerName } from '@quiesco/protocol';

import { QuiescoError } from './errors.js';
import { toMatcher, toTextMatch } from './matcher.js';
import type { MatcherInput } from './matcher.js';
import type { Permission } from './devices/permissions.js';
import type { TagNames } from './tags.js';
import type { ArtifactsConfig } from './artifacts.js';

export interface AndroidAppConfig {
  /** Application id, e.g. `com.example.myapp`. */
  package: string;
  /** APK to install. Omit when the app (e.g. a dev client) is already installed. */
  binaryPath?: string;
  /** Activity for standalone builds. Default `.MainActivity`. */
  activity?: string;
  /** Launch through an Expo dev client that loads JS from Metro. */
  devClient?: { scheme: string; metroUrl?: string };
  /** Extra host ports the app talks to on `localhost` (e.g. a local mock backend), forwarded with `adb reverse`. */
  reversePorts?: number[];
}

export interface AndroidDeviceConfig {
  type?: 'emulator' | 'device';
  /** AVD to boot when no matching emulator is running. */
  avd?: string;
  /** Use exactly this adb serial (e.g. `emulator-5554`). */
  serial?: string;
  /**
   * Parallel runs (Phase 6.12): worker N uses `serials[N]`. Without it, worker 0 uses the device above and
   * worker N > 0 an AVD of its own, `<avd>_quiesco_N`, created from `avd` on first use and kept.
   */
  serials?: string[];
  bootTimeoutMs?: number;
  /** Shut down an emulator Quiesco booted when the session ends. Default false (faster reruns). */
  shutdown?: boolean;
}

export interface IosAppConfig {
  /** Bundle identifier, e.g. `com.example.myapp`. */
  bundleId: string;
  /** Simulator build (`.app`) to install. Omit when the app (e.g. a dev client) is already installed. */
  binaryPath?: string;
  /** Launch through an Expo dev client that loads JS from Metro (passed as `--initialUrl`). */
  devClient?: { metroUrl?: string };
}

export interface IosDeviceConfig {
  /** Simulator name, e.g. `iPhone 17`. Default: the booted simulator. */
  device?: string;
  /** iOS version of the simulator runtime, e.g. `27.0`, when several runtimes have that device. */
  os?: string;
  /** Use exactly this simulator. */
  udid?: string;
  /**
   * Parallel runs (Phase 6.12): worker N uses `udids[N]`. Without it, worker 0 uses the simulator above and
   * worker N > 0 one named "<name> (Quiesco N)" of the same device type and runtime, created on first use
   * and kept.
   */
  udids?: string[];
  bootTimeoutMs?: number;
  /** Shut down a simulator Quiesco booted when the session ends. Default false (faster reruns). */
  shutdown?: boolean;
  /**
   * Turn off password AutoFill on the simulator, so iOS never covers the app with its "Save Password?"
   * sheet after a login form is submitted. Default true.
   */
  disablePasswordAutoFill?: boolean;
}

/** What to open in the browser: a static export served by Quiesco, or a running dev server. */
export interface WebAppConfig {
  /** Output of `npx expo export --platform web`; served with SPA fallback. */
  distDir?: string;
  /** URL of a running server (e.g. `http://localhost:8081` for `expo start --web`). */
  url?: string;
  /** Path opened on launch. Default `/`. */
  path?: string;
}

export interface WebViewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  /** Touch events; taps are injected with the touchscreen instead of the mouse. */
  hasTouch?: boolean;
  isMobile?: boolean;
}

export interface WebDeviceConfig {
  /** Default chromium (the only browser accepted in v1, requirements.md §11-6). */
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  /** Sizes come from the user's config; nothing is built in (§6.13). */
  viewport?: WebViewport;
}

export interface QuiescoConfig {
  apps: {
    android?: AndroidAppConfig;
    ios?: IosAppConfig;
    web?: WebAppConfig;
  };
  devices?: {
    android?: AndroidDeviceConfig;
    ios?: IosDeviceConfig;
    web?: WebDeviceConfig;
  };
  permissions?: Permission[];
  /**
   * Per-scenario artifacts (Phase 6.9): video, device logs and the timeline, each `none` / `failing` /
   * `all`, written under `dir` (default `artifacts`). Default video none, logs and timeline failing;
   * `QUIESCO_ARTIFACTS` overrides the three.
   */
  artifacts?: ArtifactsConfig;
  /**
   * Launch arguments every launch passes to the app (read there with `quiesco.launchArgs()`), any JSON.
   * `app.device.relaunch({ args })` merges its own over these (shallow).
   */
  launchArgs?: Record<string, JsonValue>;
  sync?: {
    timeoutMs?: number;
    timerThresholdMs?: number;
    countIntervals?: boolean;
    stableFrames?: number;
    ignoreUrls?: (RegExp | string)[];
    /** Disable individual trackers, e.g. `{ 'frame-stable': false }`. */
    trackers?: Partial<Record<TrackerName, boolean>>;
    /**
     * Elements whose changes never keep the app busy for the frame-stable check (they and their
     * subtrees are left out), e.g. `['logo-glow']` for a decorative animation that runs for minutes.
     * Other trackers (network, timers, React) are not affected.
     */
    ignoreElements?: MatcherInput[];
  };
  /** `native` needs @quiesco/native; when omitted, `native` is used if the app has it, else `js`. */
  actions?: {
    mode?: ActionMode;
    /**
     * How far fingers move before the app's pinch / rotation recognizers activate (logical units,
     * radians); pinch / rotate move this much first. Defaults per platform for the standard recognizers
     * (UIKit, react-native-gesture-handler); set it for others, or 0 for no compensation.
     */
    gestureSlop?: Partial<GestureSlop>;
  };
  reset?: { default?: 'soft' | 'hard' };
  server?: {
    /** Port of the Quiesco WebSocket server. Default 7357. */
    port?: number;
    /** Interface to listen on. Default: all interfaces. */
    host?: string;
  };
  /** How long to wait for the app to connect after launch. Default 30 s. */
  connectTimeoutMs?: number;
  /** Minimum app console level forwarded to the host log. Default `warn`. */
  logLevel?: LogLevel | 'off';
  /** Rename the scenario tags Quiesco reacts to (defaults: @ios @android @web @native @hard-reset). */
  tags?: Partial<TagNames>;
  /**
   * App errors that must not fail the current step (they are logged as warnings instead).
   * Matched against the error message; strings match as substrings.
   */
  appErrors?: {
    ignore?: (string | RegExp)[];
    /** Also ignore the known benign framework reports in DEFAULT_IGNORED_APP_ERRORS. Default true. */
    ignoreDefaults?: boolean;
  };
}

/**
 * Framework reports that are not real failures. Expo Router's lazy routes on the web first try a
 * synchronous require of a not-yet-loaded route chunk; Metro reports that attempt to
 * ErrorUtils.reportFatalError before the chunk is loaded and the navigation completes. It happens
 * for real users too (silently in production), see docs/known-issues.md.
 */
export const DEFAULT_IGNORED_APP_ERRORS: readonly RegExp[] = [/^Requiring unknown module "\d+"\.?/];

export function ignoredAppErrors(config: QuiescoConfig): RegExp[] {
  const own = (config.appErrors?.ignore ?? []).map((p) => (typeof p === 'string' ? new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : p));
  return config.appErrors?.ignoreDefaults === false ? own : [...DEFAULT_IGNORED_APP_ERRORS, ...own];
}

/** What a config function receives (Phase 6.12): the config is evaluated once per test worker. */
export interface ConfigContext {
  /** Parallel worker index, 0-based (0 when running serially). */
  workerIndex: number;
  /** Number of parallel workers (1 when running serially). */
  workerCount: number;
}

/** A config object, or a function computing it per worker (e.g. `reversePorts: [3001 + workerIndex]`). */
export type QuiescoConfigInput = QuiescoConfig | ((context: ConfigContext) => QuiescoConfig);

export function defineConfig(config: QuiescoConfig): QuiescoConfig;
export function defineConfig(config: (context: ConfigContext) => QuiescoConfig): (context: ConfigContext) => QuiescoConfig;
export function defineConfig(config: QuiescoConfigInput): QuiescoConfigInput {
  return config;
}

export function resolveConfig(input: QuiescoConfigInput, context: ConfigContext): QuiescoConfig {
  return typeof input === 'function' ? input(context) : input;
}

export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

/** The Quiesco server port: worker N listens on `server.port + N` (Phase 6.12). */
export function serverPort(config: QuiescoConfig, workerIndex = 0): number {
  return (config.server?.port ?? DEFAULT_PORT) + workerIndex;
}

/**
 * The agent's settings. `gestureSlop`: the provider's recognizer thresholds (pinch / rotate compensate
 * for them), overridden per field by `actions.gestureSlop`.
 */
export function toAgentConfig(config: QuiescoConfig, gestureSlop?: GestureSlop, workerIndex = 0): AgentConfig {
  const s = config.sync ?? {};
  const own = config.actions?.gestureSlop;
  const gestures = gestureSlop === undefined && own === undefined ? undefined : { pinch: own?.pinch ?? gestureSlop?.pinch ?? 0, rotation: own?.rotation ?? gestureSlop?.rotation ?? 0 };
  return {
    sync: {
      timeoutMs: s.timeoutMs ?? SyncDefaults.timeoutMs,
      timerThresholdMs: s.timerThresholdMs ?? SyncDefaults.timerThresholdMs,
      countIntervals: s.countIntervals ?? SyncDefaults.countIntervals,
      stableFrames: s.stableFrames ?? SyncDefaults.stableFrames,
      ignoreUrls: (s.ignoreUrls ?? []).map(toTextMatch),
      trackers: { ...s.trackers },
      ignoreElements: (s.ignoreElements ?? []).map(toMatcher),
    },
    logLevel: config.logLevel ?? 'warn',
    ...(gestures !== undefined ? { gestures } : {}),
    workerIndex,
  };
}

const PLATFORMS: readonly Platform[] = ['ios', 'android', 'web'];

/** Target platform: explicit value, else `QUIESCO_PLATFORM`. */
export function resolvePlatform(explicit?: string, env: NodeJS.ProcessEnv = process.env): Platform {
  const p = explicit ?? env['QUIESCO_PLATFORM'];
  if (p === undefined) throw new QuiescoError('CONFIG_ERROR', 'No target platform: set QUIESCO_PLATFORM to ios, android or web');
  if (!(PLATFORMS as readonly string[]).includes(p)) throw new QuiescoError('CONFIG_ERROR', `Unknown platform "${p}" (expected ios, android or web)`);
  return p as Platform;
}

const CONFIG_FILES = ['quiesco.config.ts', 'quiesco.config.mts', 'quiesco.config.js', 'quiesco.config.mjs'];

/**
 * Load the config file. TypeScript configs are imported directly (Node ≥ 23.6 strips types natively,
 * so only erasable syntax is allowed in the config file).
 */
export async function loadConfig(options: { cwd?: string; file?: string; worker?: ConfigContext } = {}): Promise<{ config: QuiescoConfig; file: string }> {
  const cwd = options.cwd ?? process.cwd();
  const file = options.file !== undefined ? path.resolve(cwd, options.file) : CONFIG_FILES.map((f) => path.join(cwd, f)).find((f) => fs.existsSync(f));
  if (file === undefined || !fs.existsSync(file)) {
    throw new QuiescoError('CONFIG_ERROR', `No Quiesco config found in ${cwd} (looked for ${CONFIG_FILES.join(', ')})`);
  }
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  const input = mod.default;
  if (input === null || (typeof input !== 'object' && typeof input !== 'function')) {
    throw new QuiescoError('CONFIG_ERROR', `${file} must default-export the config (export default defineConfig({ ... }))`);
  }
  const config = resolveConfig(input as QuiescoConfigInput, options.worker ?? { workerIndex: 0, workerCount: 1 });
  if (config === null || typeof config !== 'object') {
    throw new QuiescoError('CONFIG_ERROR', `the config function in ${file} must return the config object`);
  }
  return { config, file };
}
