import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { describeBundle, metroConfigUsesQuiesco, newestSource, staleBundleWarning, unknownBundleWarning } from '../src/bundle-check';

let root: string;
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function project(files: Record<string, number>): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-bundle-'));
  for (const [rel, mtime] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');
    fs.utimesSync(p, mtime / 1000, mtime / 1000);
  }
  return root;
}

const T = Date.parse('2026-11-15T10:00:00');

describe('stale bundle check (issue #3)', () => {
  it('finds the newest app source, leaving out dependencies, native projects and generated files', () => {
    project({ 'src/app/index.tsx': T, 'src/store.ts': T + 5000, 'node_modules/x/index.js': T + 9000, 'ios/Pods/a.js': T + 9000, '.expo/quiesco/build-config.js': T + 9000, 'types.d.ts': T + 9000, 'app.json': T + 9000 });
    expect(newestSource(root)).toEqual({ file: path.join(root, 'src/store.ts'), mtimeMs: T + 5000 });
  });

  it('leaves out test code and tool configs, which are not in the bundle', () => {
    project({
      'src/app/index.tsx': T,
      'features/step_definitions/app.steps.ts': T + 9000,
      'features/support/quiesco.ts': T + 9000,
      'e2e/login.test.ts': T + 9000,
      'src/store.test.ts': T + 9000,
      'src/__tests__/store.ts': T + 9000,
      'quiesco.config.mts': T + 9000,
      'cucumber.mjs': T + 9000,
      'metro.config.js': T + 9000,
      'eslint.config.js': T + 9000,
    });
    expect(newestSource(root)).toEqual({ file: path.join(root, 'src/app/index.tsx'), mtimeMs: T });
  });

  it('warns when a source file is newer than a bundle that does not follow changes', () => {
    project({ 'src/app/index.tsx': T + 60_000 });
    const ci = staleBundleWarning({ builtAt: T, watching: false, reason: 'CI' }, root, {});
    expect(ci).toMatch(/built at \d\d:\d\d:\d\d, but src\/app\/index\.tsx changed at \d\d:\d\d:\d\d: the app does not have that change \(Metro was started with CI set/);
    expect(ci).toContain('Start Metro without CI');
    expect(staleBundleWarning({ builtAt: T, watching: false, reason: 'export' }, root, {})).toContain('Build it again');
    // watching: changes arrive by themselves
    expect(staleBundleWarning({ builtAt: T, watching: true }, root, {})).toBeNull();
    expect(staleBundleWarning(undefined, root, {})).toBeNull();
  });

  it('Metro without a watcher is worth a warning even before anything changed, unless the host runs in CI too', () => {
    project({ 'src/app/index.tsx': T - 60_000 });
    expect(staleBundleWarning({ builtAt: T, watching: false, reason: 'CI' }, root, {})).toMatch(/^Metro was started with CI set, so it does not watch files/);
    expect(staleBundleWarning({ builtAt: T, watching: false, reason: 'CI' }, root, { CI: 'true' })).toBeNull();
    expect(staleBundleWarning({ builtAt: T, watching: false, reason: 'export' }, root, {})).toBeNull();
  });

  it('describes the bundle for the connection log', () => {
    expect(describeBundle(undefined, { metroConfigUsesQuiesco: false })).toBe('bundle unknown (no withQuiesco() in metro.config.js)');
    expect(describeBundle(undefined, { metroConfigUsesQuiesco: null })).toBe('bundle unknown (no withQuiesco() in metro.config.js)');
    expect(describeBundle({ builtAt: T, watching: true })).toMatch(/^Metro started \d\d:\d\d:\d\d, watching files$/);
    expect(describeBundle({ builtAt: T, watching: false, reason: 'CI' })).toMatch(/not watching files \(CI is set\)$/);
  });

  it('an unknown bundle from a reused Metro blames that Metro, not a correct metro.config.js (issue #19)', () => {
    const reused = { reusedDevServer: 'http://localhost:8081', metroConfigUsesQuiesco: true };
    expect(describeBundle(undefined, reused)).toBe('bundle unknown (the Metro at http://localhost:8081 was not started by Quiesco and runs with an unknown config)');
    expect(unknownBundleWarning(undefined, reused)).toMatch(/^The app's JS comes from the Metro dev server at http:\/\/localhost:8081, which Quiesco did not start[\s\S]*Restart it with EXPO_PUBLIC_QUIESCO=1 npx expo start, or stop it/);
    // the config really lacks withQuiesco(): that is the message, and no Metro warning
    expect(describeBundle(undefined, { ...reused, metroConfigUsesQuiesco: false })).toMatch(/no withQuiesco\(\) in metro\.config\.js/);
    expect(unknownBundleWarning(undefined, { ...reused, metroConfigUsesQuiesco: false })).toBeNull();
    // Quiesco started Metro itself (or there is none): no reuse to blame
    expect(describeBundle(undefined, { metroConfigUsesQuiesco: true })).toMatch(/built without the withQuiesco\(\) in metro\.config\.js/);
    expect(unknownBundleWarning(undefined, { metroConfigUsesQuiesco: true })).toBeNull();
    expect(unknownBundleWarning({ builtAt: T, watching: true }, reused)).toBeNull();
  });

  it('reads whether metro.config.* uses withQuiesco', () => {
    project({});
    expect(metroConfigUsesQuiesco(root)).toBeNull();
    fs.writeFileSync(path.join(root, 'metro.config.js'), 'module.exports = require("expo/metro-config").getDefaultConfig(__dirname);');
    expect(metroConfigUsesQuiesco(root)).toBe(false);
    fs.writeFileSync(path.join(root, 'metro.config.js'), "module.exports = withQuiesco(getDefaultConfig(__dirname));");
    expect(metroConfigUsesQuiesco(root)).toBe(true);
  });
});
