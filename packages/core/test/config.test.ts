import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { defineConfig, loadConfig, resolvePlatform, serverPort, toAgentConfig } from '../src/config';

describe('config', () => {
  it('defineConfig is an identity helper', () => {
    const c = { apps: {} };
    expect(defineConfig(c)).toBe(c);
  });

  it('converts sync settings to the agent config with defaults and JSON regexes', () => {
    expect(toAgentConfig({ apps: {}, sync: { timeoutMs: 5000, ignoreUrls: [/\/analytics\//i, 'sse'], trackers: { 'frame-stable': false } }, logLevel: 'info' })).toEqual({
      sync: {
        timeoutMs: 5000,
        timerThresholdMs: 1500,
        countIntervals: false,
        stableFrames: 2,
        ignoreUrls: [{ regex: { source: '\\/analytics\\/', flags: 'i' } }, 'sse'],
        trackers: { 'frame-stable': false },
        ignoreElements: [],
      },
      logLevel: 'info',
      workerIndex: 0,
    });
  });

  it('passes sync.ignoreElements to the agent as matchers', () => {
    expect(toAgentConfig({ apps: {}, sync: { ignoreElements: ['logo-glow', { text: /loading/i }] } }).sync.ignoreElements).toEqual([
      { id: 'logo-glow' },
      { text: { regex: { source: 'loading', flags: 'i' } } },
    ]);
  });

  it('passes the provider gesture thresholds, overridden per field by actions.gestureSlop', () => {
    expect(toAgentConfig({ apps: {} }).gestures).toBeUndefined();
    expect(toAgentConfig({ apps: {} }, { pinch: 9, rotation: 0.1 }).gestures).toEqual({ pinch: 9, rotation: 0.1 });
    expect(toAgentConfig({ apps: {}, actions: { gestureSlop: { pinch: 0 } } }, { pinch: 9, rotation: 0.1 }).gestures).toEqual({ pinch: 0, rotation: 0.1 });
  });

  it('uses server.port or 7357', () => {
    expect(serverPort({ apps: {} })).toBe(7357);
    expect(serverPort({ apps: {}, server: { port: 8000 } })).toBe(8000);
  });

  it('resolves the platform from the argument or QUIESCO_PLATFORM', () => {
    expect(resolvePlatform('web', {})).toBe('web');
    expect(resolvePlatform(undefined, { QUIESCO_PLATFORM: 'android' })).toBe('android');
    expect(() => resolvePlatform(undefined, {})).toThrow(/QUIESCO_PLATFORM/);
    expect(() => resolvePlatform('symbian', {})).toThrow(/Unknown platform/);
  });

  it('loads quiesco.config.* from the working directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-config-'));
    fs.writeFileSync(path.join(dir, 'quiesco.config.mjs'), 'export default { apps: { android: { package: "com.x" } } };\n');
    const { config, file } = await loadConfig({ cwd: dir });
    expect(config.apps.android?.package).toBe('com.x');
    expect(file).toBe(path.join(dir, 'quiesco.config.mjs'));
    await expect(loadConfig({ cwd: os.tmpdir(), file: 'nope.config.ts' })).rejects.toThrow(/No Quiesco config/);
    fs.writeFileSync(path.join(dir, 'bad.mjs'), 'export const x = 1;\n');
    await expect(loadConfig({ cwd: dir, file: 'bad.mjs' })).rejects.toThrow(/must default-export/);
  });
});

describe('ignored app errors', async () => {
  const { ignoredAppErrors } = await import('../src/config');
  it('ignores the known benign Expo web chunk report by default, plus user patterns', () => {
    const list = ignoredAppErrors({ apps: {}, appErrors: { ignore: ['ResizeObserver loop', /^Warning:/] } });
    const ignored = (m: string) => list.some((re) => re.test(m));
    expect(ignored('Requiring unknown module "818".')).toBe(true);
    expect(ignored('ResizeObserver loop limit exceeded (x)')).toBe(true);
    expect(ignored('Warning: something')).toBe(true);
    expect(ignored('undefined is not a function')).toBe(false);
  });
  it('can drop the defaults', () => {
    expect(ignoredAppErrors({ apps: {}, appErrors: { ignoreDefaults: false } })).toEqual([]);
  });
});

describe('tags', async () => {
  const { runsOnPlatform, tagNames } = await import('../src/tags');
  it('untagged scenarios run everywhere; platform tags restrict; @native = ios + android', () => {
    expect(runsOnPlatform(['@smoke'], 'web')).toBe(true);
    expect(runsOnPlatform(['@android'], 'android')).toBe(true);
    expect(runsOnPlatform(['@android'], 'web')).toBe(false);
    expect(runsOnPlatform(['@native'], 'ios')).toBe(true);
    expect(runsOnPlatform(['@native'], 'web')).toBe(false);
    expect(runsOnPlatform(['@web', '@ios'], 'ios')).toBe(true);
  });
  it('the innermost level with a platform tag decides', () => {
    // feature @native, scenario @android → Android only (not the union).
    expect(runsOnPlatform([['@native'], [], ['@android'], []], 'android')).toBe(true);
    expect(runsOnPlatform([['@native'], [], ['@android'], []], 'ios')).toBe(false);
    // levels without platform tags fall through to the outer ones.
    expect(runsOnPlatform([['@native'], [], ['@smoke'], []], 'ios')).toBe(true);
    expect(runsOnPlatform([['@native'], [], ['@smoke'], []], 'web')).toBe(false);
    // a rule overrides the feature, examples override the scenario.
    expect(runsOnPlatform([['@native'], ['@web'], [], []], 'web')).toBe(true);
    expect(runsOnPlatform([['@native'], ['@web'], ['@ios'], ['@android']], 'android')).toBe(true);
    expect(runsOnPlatform([['@native'], ['@web'], ['@ios'], ['@android']], 'ios')).toBe(false);
    // several platform tags on one level still add up.
    expect(runsOnPlatform([['@ios'], ['@web', '@android']], 'android')).toBe(true);
    expect(runsOnPlatform([[], [], [], []], 'web')).toBe(true);
    expect(runsOnPlatform([], 'web')).toBe(true);
  });
  it('flattens leveled tags outermost first', async () => {
    const { flattenTags } = await import('../src/tags');
    expect(flattenTags([['@native'], [], ['@android', '@hard-reset']])).toEqual(['@native', '@android', '@hard-reset']);
    expect(flattenTags(['@web'])).toEqual(['@web']);
  });
  it('tag names are configurable', () => {
    const names = tagNames({ web: '@browser' });
    expect(runsOnPlatform(['@browser'], 'web', names)).toBe(true);
    expect(runsOnPlatform(['@web'], 'android', names)).toBe(true); // no longer a platform tag
    expect(names.hardReset).toBe('@hard-reset');
  });
});
