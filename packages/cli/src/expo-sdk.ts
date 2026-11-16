/**
 * The project's Expo SDK and whether Quiesco supports it (.planning/2026-11-16-expo-sdk-55-57):
 * `doctor` fails below MIN_EXPO_SDK, `init` warns.
 */
import type { CliContext } from './context.js';
import { installedVersion } from './packages.js';

/**
 * The oldest supported Expo SDK. From SDK 55 the New Architecture is always on; Quiesco's agent reads
 * Fabric's tree and @quiesco/native injects touches into it. 55–58 are run in CI (web) and accepted on
 * iOS / Android with scripts/sdk-compat.mjs.
 */
export const MIN_EXPO_SDK = 55;

export interface ExpoSdk {
  /** The SDK number: the major version of `expo`. */
  sdk: number;
  /** The installed version, or the range in package.json when `expo` is not installed. */
  version: string;
  installed: boolean;
}

/** The Expo SDK of the project in ctx.cwd; null when `expo` is neither installed nor a numeric range. */
export function expoSdk(ctx: CliContext, declared: string | undefined): ExpoSdk | null {
  const installed = installedVersion(ctx, 'expo');
  if (installed !== null) {
    const m = /^(\d+)\./.exec(installed);
    if (m !== null) return { sdk: Number(m[1]), version: installed, installed: true };
  }
  // "~54.0.3", "^55.0.0", "55", ">=55.0.0"; not "latest", "workspace:*", a URL or a path.
  const m = declared !== undefined ? /^\s*(?:[~^]|>=?)?\s*(\d+)(?:\.|$)/.exec(declared) : null;
  return m !== null && declared !== undefined ? { sdk: Number(m[1]), version: declared, installed: false } : null;
}

/** How to upgrade, for messages about an SDK that is too old. */
export const UPGRADE_SDK_FIX = `Quiesco supports Expo SDK ${MIN_EXPO_SDK} and later (the New Architecture is always on from SDK ${MIN_EXPO_SDK}). Upgrade the app: npx expo install expo@^${MIN_EXPO_SDK}.0.0 --fix (https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).`;
