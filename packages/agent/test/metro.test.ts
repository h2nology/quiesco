import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { withQuiesco } = require('../metro.cjs') as {
  withQuiesco: <T extends object>(config: T, options?: { enabled?: boolean; env?: Record<string, string>; projectRoot?: string }) => T & {
    resolver: { resolveRequest: (ctx: unknown, name: string, platform: string | null) => unknown };
    serializer?: { getModulesRunBeforeMainModule?: (entry: string) => string[] };
  };
};

const agentSrc = path.resolve(__dirname, '../src');

function ctx() {
  return { originModulePath: '/app/App.tsx', resolveRequest: vi.fn(() => ({ type: 'sourceFile', filePath: '/resolved' })) };
}

describe('withQuiesco', () => {
  it('resolves @quiesco/agent to the stub in non-e2e builds and leaves other modules alone', () => {
    const c = ctx();
    const config = withQuiesco({ resolver: {} }, { env: {} });
    expect(config.resolver.resolveRequest(c, '@quiesco/agent', 'android')).toEqual({ type: 'sourceFile', filePath: path.join(agentSrc, 'stub.ts') });
    expect(config.resolver.resolveRequest(c, 'react', 'android')).toEqual({ type: 'sourceFile', filePath: '/resolved' });
  });

  it('keeps the real agent in e2e builds and swaps in a generated build-config', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-metro-'));
    const upstream = vi.fn(() => 'upstream');
    const config = withQuiesco({ projectRoot: root, resolver: { resolveRequest: upstream } }, { env: { EXPO_PUBLIC_QUIESCO: '1', EXPO_PUBLIC_QUIESCO_PORT: '7999' } });
    const c = ctx();
    expect(config.resolver.resolveRequest(c, '@quiesco/agent', 'ios')).toBe('upstream');
    const fromAgent = { ...c, originModulePath: path.join(agentSrc, 'runtime.ts') };
    const resolved = config.resolver.resolveRequest(fromAgent, './build-config', 'ios') as { filePath: string };
    expect(resolved.filePath).toBe(path.join(root, '.expo', 'quiesco', 'build-config.js'));
    expect(fs.readFileSync(resolved.filePath, 'utf8')).toContain('export const buildConfig = {"port":7999,"session":null};');
    // a './build-config' import from app code is not touched
    expect(config.resolver.resolveRequest(c, './build-config', 'ios')).toBe('upstream');
  });
});

describe('withQuiesco: expo/fetch', () => {
  const shim = path.join(agentSrc, 'expo-fetch.js');

  it('sends the app\'s expo/fetch imports to the tracked re-export in e2e builds', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-metro-'));
    const upstream = vi.fn(() => 'upstream');
    const config = withQuiesco({ projectRoot: root, resolver: { resolveRequest: upstream } }, { env: { EXPO_PUBLIC_QUIESCO: '1' } });
    expect(config.resolver.resolveRequest(ctx(), 'expo/fetch', 'ios')).toEqual({ type: 'sourceFile', filePath: shim });
    const lib = { ...ctx(), originModulePath: '/app/node_modules/some-lib/index.js' };
    expect(config.resolver.resolveRequest(lib, 'expo/fetch', 'android')).toEqual({ type: 'sourceFile', filePath: shim });
    // the re-export itself reaches the real module
    expect(config.resolver.resolveRequest({ ...ctx(), originModulePath: shim }, 'expo/fetch', 'ios')).toBe('upstream');
  });

  it('leaves expo/fetch alone in production builds', () => {
    const c = ctx();
    const config = withQuiesco({ resolver: {} }, { env: {} });
    expect(config.resolver.resolveRequest(c, 'expo/fetch', 'ios')).toEqual({ type: 'sourceFile', filePath: '/resolved' });
  });
});

describe('withQuiesco: early module', () => {
  const early = fs.realpathSync(path.join(agentSrc, 'early.ts'));

  it('runs the agent early module before React Native setup in e2e builds', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-metro-'));
    const upstream = vi.fn(() => ['/rn/setup-env.js', '/expo/winter.js']);
    const config = withQuiesco({ projectRoot: root, resolver: {}, serializer: { getModulesRunBeforeMainModule: upstream } }, { env: { EXPO_PUBLIC_QUIESCO: '1' } });
    expect(config.serializer?.getModulesRunBeforeMainModule?.('/app/index.ts')).toEqual([early, '/rn/setup-env.js', '/expo/winter.js']);
    expect(upstream).toHaveBeenCalledWith('/app/index.ts');
    // Expo's export serializer holds on to the original serializer object: it must see the change too.
    const original = { getModulesRunBeforeMainModule: () => ['/rn/setup-env.js'] };
    withQuiesco({ projectRoot: root, resolver: {}, serializer: original }, { env: { EXPO_PUBLIC_QUIESCO: '1' } });
    expect(original.getModulesRunBeforeMainModule()).toEqual([early, '/rn/setup-env.js']);
    const bare = withQuiesco({ projectRoot: root, resolver: {} }, { env: { EXPO_PUBLIC_QUIESCO: '1' } });
    expect(bare.serializer?.getModulesRunBeforeMainModule?.('/app/index.ts')).toEqual([early]);
  });

  it('leaves the serializer alone in production builds', () => {
    const before = () => ['/rn/setup-env.js'];
    const config = withQuiesco({ resolver: {}, serializer: { getModulesRunBeforeMainModule: before } }, { env: {} });
    expect(config.serializer?.getModulesRunBeforeMainModule).toBe(before);
  });
});

describe('package', () => {
  it('AGENT_VERSION matches package.json', async () => {
    const { AGENT_VERSION } = await import('../src/version');
    expect(AGENT_VERSION).toBe((require('../package.json') as { version: string }).version);
  });
});
