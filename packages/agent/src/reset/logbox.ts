/**
 * React Native's LogBox (issue #31). Browsers have none: the web build gets this module, iOS / Android
 * get logbox.native.ts.
 */
export interface LogBoxLike {
  clearAllLogs(): void;
  ignoreAllLogs(value?: boolean): void;
}

export function appLogBox(): LogBoxLike | null {
  return null;
}
