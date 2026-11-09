/**
 * Test launch arguments on the wire (Phase 6.5, HU 2026-11-09: one JSON parameter). Native platforms get
 * base64 of the JSON with every non-ASCII character escaped as \uXXXX, so the app decodes it with plain
 * `atob` and no device shell quoting is involved (base64 has no shell metacharacters).
 */
import type { JsonValue } from '@quiesco/protocol';

import { QuiescoError } from './errors.js';
import { findNonJson } from './json.js';

export type LaunchArgs = Record<string, JsonValue>;

/** Throws CONFIG_ERROR for values JSON cannot carry (functions, undefined, NaN, Dates, ...). */
export function checkLaunchArgs(args: unknown, where: string): LaunchArgs {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new QuiescoError('CONFIG_ERROR', `${where} must be a plain object of JSON values`);
  }
  const bad = findNonJson(args, where);
  if (bad !== null) throw new QuiescoError('CONFIG_ERROR', `${where}: ${bad.path} is not JSON (${bad.reason})`);
  return args as LaunchArgs;
}

/** ASCII-only JSON → base64. */
export function encodeLaunchArgs(args: LaunchArgs): string {
  const ascii = JSON.stringify(args).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return Buffer.from(ascii, 'latin1').toString('base64');
}
