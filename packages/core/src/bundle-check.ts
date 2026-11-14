/**
 * Stale JS bundles (issue #3): when the app's bundle does not follow source changes (Metro started with
 * `CI` set, or a one-off `expo export`), edits made after it was built never reach the app, and nothing
 * said so. The agent reports where its bundle comes from (`hello.bundle`); this compares that with the
 * project's source files.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { BundleInfo } from '@quiesco/protocol';

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
/** Not app source: dependencies, generated output, native projects, test artifacts. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.expo', 'ios', 'android', 'dist', 'web-build', 'build', 'artifacts', 'coverage', 'reports']);
/** Bounds the walk in a large project; the newest of these is enough to tell. */
const MAX_FILES = 5000;

/** The most recently changed source file under `root`, or null. */
export function newestSource(root: string): { file: string; mtimeMs: number } | null {
  let newest: { file: string; mtimeMs: number } | null = null;
  let seen = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (seen >= MAX_FILES) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p);
      } else if (e.isFile() && SOURCE.test(e.name) && !e.name.endsWith('.d.ts')) {
        seen++;
        const mtimeMs = fs.statSync(p, { throwIfNoEntry: false })?.mtimeMs;
        if (mtimeMs !== undefined && (newest === null || mtimeMs > newest.mtimeMs)) newest = { file: p, mtimeMs };
      }
    }
  };
  walk(root);
  return newest;
}

const time = (ms: number): string => new Date(ms).toTimeString().slice(0, 8);

/** `bundle built 10:02:11, Metro watching files` for the connection log line. */
export function describeBundle(bundle: BundleInfo | undefined): string {
  if (bundle === undefined) return 'bundle unknown (no withQuiesco() in metro.config.js)';
  if (bundle.watching) return `Metro started ${time(bundle.builtAt)}, watching files`;
  return `bundle built ${time(bundle.builtAt)}, ${bundle.reason === 'CI' ? 'Metro not watching files (CI is set)' : 'a one-off export'}`;
}

/**
 * A warning when the bundle cannot have the project's latest changes, else null.
 * - Metro started with `CI` set: always (unless this host also runs in CI, where that is intended), since
 *   later edits will not arrive either.
 * - Any bundle that does not follow changes: when a source file is newer than the bundle.
 */
export function staleBundleWarning(bundle: BundleInfo | undefined, projectRoot: string, hostEnv: NodeJS.ProcessEnv = process.env): string | null {
  if (bundle === undefined || bundle.watching) return null;
  const fix =
    bundle.reason === 'CI'
      ? 'Start Metro without CI (EXPO_PUBLIC_QUIESCO=1 npx expo start), or restart it after each change'
      : 'Build it again (e.g. EXPO_PUBLIC_QUIESCO=1 npx expo export --platform web)';
  const newest = newestSource(projectRoot);
  // A second of slack: the export reads files written just before it started.
  if (newest !== null && newest.mtimeMs > bundle.builtAt + 1000) {
    return `The app runs a JS bundle built at ${time(bundle.builtAt)}, but ${path.relative(projectRoot, newest.file)} changed at ${time(newest.mtimeMs)}: the app does not have that change (${bundle.reason === 'CI' ? 'Metro was started with CI set, so it does not watch files' : 'the bundle is a one-off export'}). ${fix}.`;
  }
  const hostInCi = hostEnv['CI'] !== undefined && hostEnv['CI'] !== '' && hostEnv['CI'] !== '0' && hostEnv['CI'].toLowerCase() !== 'false';
  if (bundle.reason === 'CI' && !hostInCi) {
    return `Metro was started with CI set, so it does not watch files: changes you make now will not reach the app. ${fix}.`;
  }
  return null;
}
