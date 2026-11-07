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
      },
      logLevel: 'info',
    });
  });

  it('gives each worker its own port', () => {
    expect(serverPort({ apps: {} })).toBe(7357);
    expect(serverPort({ apps: {}, server: { port: 8000 } }, 2)).toBe(8002);
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
