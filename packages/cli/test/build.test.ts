import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { QuiescoConfig } from '@quiesco/core';

import { androidVariant, buildCommand, iosBuildTarget } from '../src/commands/build';
import { fakeContext } from './fake-context';
import type { FakeContext } from './fake-context';

const IOS_BIN = 'ios/build/Build/Products/Debug-iphonesimulator/myapp.app';

/** A project whose native build steps "work": xcodebuild / gradle leave their output where they would. */
function project(config: QuiescoConfig, opts: { fail?: string } = {}) {
  const ctx: FakeContext = fakeContext((command, args) => {
    const step = command === 'npx' ? `npx ${args.slice(0, 2).join(' ')}` : command;
    if (opts.fail !== undefined && step.includes(opts.fail)) return { code: 65 };
    if (command === 'npx' && args[1] === 'prebuild' && args[3] === 'ios') ctx.put('ios/myapp.xcworkspace/contents.xcworkspacedata', '');
    if (command === 'xcodebuild') ctx.put(`${args[args.indexOf('-derivedDataPath') + 1]}/Build/Products/${args[args.indexOf('-configuration') + 1]}-iphonesimulator/${args[args.indexOf('-scheme') + 1]}.app/Info.plist`, '');
    if (command === './gradlew') ctx.put(`android/app/build/outputs/apk/${args[0] === 'assembleRelease' ? 'release' : 'debug'}/app-${args[0] === 'assembleRelease' ? 'release' : 'debug'}.apk`, 'apk');
    return { code: 0 };
  });
  ctx.put('package.json', JSON.stringify({ dependencies: { expo: '~58.0.25', '@quiesco/native': '0.2.0' } }));
  ctx.put('node_modules/@quiesco/native/package.json', JSON.stringify({ version: '0.2.0' }));
  ctx.put('app.json', JSON.stringify({ expo: { name: 'myapp' } }));
  const deps = { loadConfig: async () => config };
  const steps = () => ctx.calls.map((c) => `${c.command} ${c.args.join(' ')}`);
  return { ctx, deps, steps };
}

describe('quiesco build (issue #5)', () => {
  it('reads the xcodebuild target and the gradle variant from binaryPath', () => {
    expect(iosBuildTarget(IOS_BIN)).toEqual({ derivedData: 'ios/build', configuration: 'Debug', name: 'myapp' });
    expect(iosBuildTarget('/abs/dd/Build/Products/Release-iphonesimulator/My App.app')).toEqual({ derivedData: '/abs/dd', configuration: 'Release', name: 'My App' });
    expect(iosBuildTarget('build/myapp.app')).toBeNull();
    expect(androidVariant('android/app/build/outputs/apk/debug/app-debug.apk')).toBe('debug');
    expect(androidVariant('android/app/build/outputs/apk/release/app-release.apk')).toBe('release');
    expect(androidVariant('builds/e2e.apk')).toBe('debug');
  });

  it('iOS: prebuild, then xcodebuild into the derived data path of binaryPath, with EXPO_PUBLIC_QUIESCO=1; then up to date', async () => {
    const { ctx, deps, steps } = project({ apps: { ios: { bundleId: 'b', binaryPath: IOS_BIN } } });
    expect(await buildCommand(['ios'], ctx, deps)).toBe(0);
    expect(steps()).toEqual([
      'npx expo prebuild --platform ios',
      "xcodebuild -workspace ios/myapp.xcworkspace -scheme myapp -configuration Debug -sdk iphonesimulator -destination generic/platform=iOS Simulator -derivedDataPath ios/build -quiet build",
    ]);
    expect(ctx.calls.every((c) => c.env?.['EXPO_PUBLIC_QUIESCO'] === '1')).toBe(true);
    expect(ctx.lines.at(-1)).toBe(`quiesco build: ${IOS_BIN} is ready.`);
    // nothing native changed: skipped
    ctx.calls.length = 0;
    expect(await buildCommand(['ios'], ctx, deps)).toBe(0);
    expect(steps()).toEqual([]);
    expect(ctx.lines.at(-1)).toMatch(/is up to date/);
    // --force, or a changed native dependency, builds again
    expect(await buildCommand(['ios', '--force'], ctx, deps)).toBe(0);
    expect(steps()).toHaveLength(2);
    ctx.calls.length = 0;
    ctx.put('node_modules/@quiesco/native/package.json', JSON.stringify({ version: '0.2.1' }));
    expect(await buildCommand(['ios'], ctx, deps)).toBe(0);
    expect(steps()).toHaveLength(2);
  });

  it('Android: gradle assembleDebug, the APK copied to binaryPath when it is elsewhere; release is always built', async () => {
    const { ctx, deps, steps } = project({ apps: { android: { package: 'p', binaryPath: 'builds/e2e.apk' } } });
    expect(await buildCommand(['android'], ctx, deps)).toBe(0);
    expect(steps()).toEqual(['npx expo prebuild --platform android', './gradlew assembleDebug']);
    expect(ctx.calls[1]?.command).toBe('./gradlew');
    expect(ctx.file('builds/e2e.apk')).toBe('apk');
    const rel = project({ apps: { android: { package: 'p', binaryPath: 'android/app/build/outputs/apk/release/app-release.apk' } } });
    expect(await buildCommand(['android'], rel.ctx, rel.deps)).toBe(0);
    rel.ctx.calls.length = 0;
    expect(await buildCommand(['android'], rel.ctx, rel.deps)).toBe(0);
    expect(rel.steps()).toEqual(['npx expo prebuild --platform android', './gradlew assembleRelease']);
  });

  it('explains what is wrong', async () => {
    const noPlatform = project({ apps: {} });
    expect(await buildCommand([], noPlatform.ctx, noPlatform.deps)).toBe(2);
    expect(noPlatform.ctx.errors[0]).toMatch(/choose ios or android/);
    expect(await buildCommand(['ios'], noPlatform.ctx, noPlatform.deps)).toBe(2);
    expect(noPlatform.ctx.errors[1]).toMatch(/apps\.ios\.binaryPath is not set/);
    const odd = project({ apps: { ios: { bundleId: 'b', binaryPath: 'build/myapp.app' } } });
    expect(await buildCommand(['ios'], odd.ctx, odd.deps)).toBe(2);
    expect(odd.ctx.errors[0]).toMatch(/must look like <dir>\/Build\/Products/);
    const wrongName = project({ apps: { ios: { bundleId: 'b', binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/Other.app' } } });
    expect(await buildCommand(['ios'], wrongName.ctx, wrongName.deps)).toBe(1);
    expect(wrongName.ctx.errors[0]).toMatch(/ios\/Other\.xcworkspace not found after prebuild/);
    const broken = project({ apps: { ios: { bundleId: 'b', binaryPath: IOS_BIN } } }, { fail: 'xcodebuild' });
    expect(await buildCommand(['ios'], broken.ctx, broken.deps)).toBe(65);
    expect(broken.ctx.errors[0]).toBe('quiesco build: xcodebuild failed (exit code 65).');
    expect(broken.ctx.file(path.join('.expo', 'quiesco', 'build-ios.json'))).toBeNull();
  });
});
