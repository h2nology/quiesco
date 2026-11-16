/**
 * React Native's LogBox on iOS / Android (issue #31; Metro picks this over logbox.ts). In dev builds a
 * `console.error` shows a LogBox toast over the bottom of the screen until it is dismissed, so one app
 * error would block taps there in every later scenario. Expo's own LogBox UI (@expo/log-box) only replaces
 * the views and keeps React Native's LogBoxData, so these calls clear it too. Release builds: no-ops.
 */
import type { LogBoxLike } from './logbox';

export type { LogBoxLike } from './logbox';

declare const require: (id: string) => unknown;

export function appLogBox(): LogBoxLike | null {
  try {
    const lb = (require('react-native') as { LogBox?: Partial<LogBoxLike> }).LogBox;
    return lb !== undefined && typeof lb.clearAllLogs === 'function' && typeof lb.ignoreAllLogs === 'function' ? (lb as LogBoxLike) : null;
  } catch {
    return null;
  }
}
