import { describe, expect, it } from 'vitest';

import type { DoctorDeps } from '../src/commands/doctor';
import { runChecks } from '../src/commands/doctor';
import { main } from '../src/cli';
import { MIN_EXPO_SDK, expoSdk } from '../src/expo-sdk';
import type { FakeContext } from './fake-context';
import { fakeContext, freshExpoApp } from './fake-context';

const deps: DoctorDeps = { loadConfig: async () => ({ apps: { web: { distDir: 'dist' } } }), portFree: async () => true };

function app(expo: string, installed?: string): FakeContext {
  const ctx = fakeContext();
  freshExpoApp(ctx);
  ctx.put('package.json', JSON.stringify({ name: 'my-app', main: 'expo-router/entry', dependencies: { expo } }));
  if (installed !== undefined) ctx.put('node_modules/expo/package.json', JSON.stringify({ name: 'expo', version: installed }));
  return ctx;
}

async function expoResult(ctx: FakeContext) {
  return (await runChecks(ctx, 'web', deps)).find((r) => r.name === 'Expo project');
}

describe('expoSdk', () => {
  it('prefers the installed version, then the major of the range in package.json', () => {
    expect(expoSdk(app('~58.0.23', '55.0.32'), '~58.0.23')).toEqual({ sdk: 55, version: '55.0.32', installed: true });
    for (const [range, sdk] of [['~54.0.3', 54], ['^55.0.0', 55], ['56', 56], ['>=57.0.0', 57], ['57.0.33', 57]] as const) {
      expect(expoSdk(app(range), range)).toEqual({ sdk, version: range, installed: false });
    }
    for (const range of ['latest', 'workspace:*', 'file:../expo', undefined]) expect(expoSdk(app('x'), range)).toBeNull();
  });
});

describe('Expo SDK support', () => {
  it('is 55 and later', () => expect(MIN_EXPO_SDK).toBe(55));

  it('doctor: ok from SDK 55, fails below with how to upgrade', async () => {
    expect(await expoResult(app('~55.0.32', '55.0.32'))).toMatchObject({ status: 'ok', detail: 'expo 55.0.32 (SDK 55)' });
    expect(await expoResult(app('~58.0.23'))).toMatchObject({ status: 'ok', detail: 'expo ~58.0.23 (SDK 58, not installed)' });
    expect(await expoResult(app('~54.0.3', '54.0.3'))).toMatchObject({
      status: 'fail',
      detail: 'expo 54.0.3 (SDK 54)',
      fix: expect.stringMatching(/SDK 55 and later .*npx expo install expo@\^55\.0\.0 --fix/),
    });
    // a range it cannot read is not judged
    expect(await expoResult(app('latest'))).toMatchObject({ status: 'ok', detail: 'expo latest' });
  });

  it('init: warns below SDK 55 and sets the project up anyway', async () => {
    const old = app('~54.0.3', '54.0.3');
    expect(await main(['init', '--skip-install', '--platforms', 'web'], old)).toBe(0);
    expect(old.errors.join('\n')).toMatch(/warning: this app is on Expo SDK 54 \(expo 54\.0\.3\)\. Quiesco supports Expo SDK 55 and later/);
    expect(old.file('quiesco.config.mts')).not.toBeNull();

    const supported = app('~55.0.32', '55.0.32');
    expect(await main(['init', '--skip-install', '--platforms', 'web'], supported)).toBe(0);
    expect(supported.errors.join('\n')).not.toMatch(/Expo SDK/);
  });
});
