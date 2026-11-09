/**
 * The native sources, the autolinking config and the published files must agree, or a platform silently
 * loses the module (requireOptionalNativeModule returns null and Quiesco falls back to js mode).
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json')) as { files: string[]; version: string };
const config = JSON.parse(read('expo-module.config.json')) as {
  platforms: string[];
  apple?: { modules: string[] };
  android?: { modules: string[] };
};

/** Whether a `files` pattern of package.json covers `file` (only `dir/*.ext`, `dir/name` and `dir` forms are used). */
function published(file: string): boolean {
  return pkg.files.some((pattern) => {
    if (pattern === file || file.startsWith(`${pattern}/`)) return true;
    const m = /^(.*)\/\*(\.\w+)$/.exec(pattern);
    return m !== null && path.dirname(file) === m[1] && file.endsWith(m[2] as string);
  });
}

describe('expo-module.config.json', () => {
  it('declares both platforms', () => {
    expect(config.platforms).toEqual(expect.arrayContaining(['apple', 'android']));
  });

  it('names an existing Swift module class for iOS, exported as "QuiescoNative"', () => {
    for (const cls of config.apple?.modules ?? []) {
      const swift = read(`ios/${cls}.swift`);
      expect(swift).toContain(`class ${cls}: Module`);
      expect(swift).toContain('Name("QuiescoNative")');
    }
    expect(config.apple?.modules).toHaveLength(1);
  });

  it('names an existing Kotlin module class for Android, exported as "QuiescoNative"', () => {
    for (const fqcn of config.android?.modules ?? []) {
      const kt = read(`android/src/main/java/${fqcn.replace(/\./g, '/')}.kt`);
      expect(kt).toContain('Name("QuiescoNative")');
    }
    expect(config.android?.modules).toHaveLength(1);
  });
});

describe('iOS sources', () => {
  const sources = fs.readdirSync(path.join(root, 'ios')).map((f) => `ios/${f}`);

  it('are all published', () => {
    expect(sources.filter((f) => !published(f))).toEqual([]);
  });

  it('podspec takes the package version, links IOKit and compiles every source', () => {
    const podspec = read('ios/QuiescoNative.podspec');
    expect(podspec).toContain("package['version']");
    expect(podspec).toContain("s.frameworks = 'IOKit'");
    expect(podspec).toContain("s.source_files = '**/*.{h,m,swift}'");
  });

  it('the Swift module exposes the same functions as the Android module, plus the iOS-only openUrl, idleState, hitAt, wheelInfo, suspend and setOrientation', () => {
    const fns = (src: string): string[] => [...src.matchAll(/(?:Async)?Function\("(\w+)"\)/g)].map((m) => m[1] as string).sort();
    const kt = read(`android/src/main/java/${(config.android?.modules[0] ?? '').replace(/\./g, '/')}.kt`);
    const swift = read(`ios/${config.apple?.modules[0] ?? ''}.swift`);
    expect(fns(swift)).toEqual([...fns(kt), 'hitAt', 'idleState', 'openUrl', 'setOrientation', 'suspend', 'wheelInfo'].sort());
  });
});
