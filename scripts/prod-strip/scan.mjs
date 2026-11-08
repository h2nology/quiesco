// @ts-check
/**
 * Artifact scanning for scripts/check-prod-strip.mjs (docs/spikes/06-prod-strip.md). Pure functions over
 * files on disk, so they are unit-tested without building anything.
 *
 * A marker is a byte string that only Quiesco code puts into an artifact. A production build must
 * contain none; an e2e build (the control group) must contain every one, which proves the marker
 * survives minification / Hermes / R8 / linking and the check would notice a leak.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {{ name: string, text: string }} Marker
 * @typedef {'prod' | 'e2e'} Mode
 * @typedef {{ marker: string, count: number, files: string[] }} MarkerHit
 */

/**
 * JS markers: string literals of the real agent (protocol method names, an agent error prefix) that
 * the production stub (packages/agent/src/stub.ts) does not contain. Found in Web JS and in Hermes
 * bytecode (its string table keeps literals as UTF-8).
 * @type {Marker[]}
 */
export const JS_MARKERS = [
  { name: 'agent: getIdleState', text: 'getIdleState' },
  { name: 'agent: waitForIdle', text: 'waitForIdle' },
  { name: 'agent: error prefix', text: 'agent error: ' },
];

/**
 * Android: the Expo Module name (`Name("QuiescoNative")`) is a string constant R8 does not rename;
 * class names would be obfuscated in release builds and match nothing even in the control group.
 * @type {Marker[]}
 */
export const ANDROID_MARKERS = [{ name: 'native: module name', text: 'QuiescoNative' }];

/**
 * iOS: the touch injector class (ObjC class name / symbol) and the private IOKit function it links
 * against (an undefined symbol of the binary).
 * @type {Marker[]}
 */
export const IOS_MARKERS = [
  { name: 'native: QSTouchInjector', text: 'QSTouchInjector' },
  { name: 'native: IOHIDEventCreateDigitizerEvent', text: 'IOHIDEventCreateDigitizerEvent' },
];

/** Count non-overlapping occurrences of `needle` in `haystack`. */
export function countOccurrences(/** @type {Buffer} */ haystack, /** @type {Buffer} */ needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/** All regular files under `dir` (symlinks are not followed), sorted for stable reports. */
export function listFiles(/** @type {string} */ dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Count every marker in every file under the given roots (a root may also be a single file).
 * @param {string[]} roots
 * @param {Marker[]} markers
 * @returns {MarkerHit[]}
 */
export function scan(roots, markers) {
  const needles = markers.map((m) => Buffer.from(m.text, 'utf8'));
  /** @type {MarkerHit[]} */
  const hits = markers.map((m) => ({ marker: m.name, count: 0, files: [] }));
  for (const root of roots) {
    if (!fs.existsSync(root)) throw new Error(`artifact not found: ${root}`);
    const files = fs.statSync(root).isDirectory() ? listFiles(root) : [root];
    for (const file of files) {
      const data = fs.readFileSync(file);
      needles.forEach((needle, i) => {
        const n = countOccurrences(data, needle);
        const hit = /** @type {MarkerHit} */ (hits[i]);
        if (n > 0) {
          hit.count += n;
          hit.files.push(path.relative(path.dirname(root), file));
        }
      });
    }
  }
  return hits;
}

/**
 * Production: no marker may be present. e2e (control group): every marker must be present.
 * @param {MarkerHit[]} hits
 * @param {Mode} mode
 * @returns {string[]} failure messages, empty when the artifact is as expected
 */
export function judge(hits, mode) {
  if (mode === 'prod') {
    return hits.filter((h) => h.count > 0).map((h) => `${h.marker}: found ${h.count}× in a production build (${h.files.slice(0, 3).join(', ')})`);
  }
  return hits
    .filter((h) => h.count === 0)
    .map((h) => `${h.marker}: missing from the e2e build (control group) — the marker no longer proves anything; update it`);
}

/**
 * Markdown table of all results.
 * @param {{ platform: string, mode: Mode, hits: MarkerHit[] }[]} results
 */
export function report(results) {
  const lines = ['| platform | mode | marker | count | expected | ok |', '|---|---|---|---|---|---|'];
  for (const r of results) {
    for (const h of r.hits) {
      const ok = r.mode === 'prod' ? h.count === 0 : h.count > 0;
      lines.push(`| ${r.platform} | ${r.mode} | ${h.marker} | ${h.count} | ${r.mode === 'prod' ? '0' : '≥1'} | ${ok ? '✅' : '❌'} |`);
    }
  }
  return lines.join('\n');
}
