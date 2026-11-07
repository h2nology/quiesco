import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { withQuiesco } = require('../metro.cjs') as {
  withQuiesco: <T extends object>(config: T, options?: { enabled?: boolean; env?: Record<string, string>; projectRoot?: string }) => T & {
    resolver: { resolveRequest: (ctx: unknown, name: string, platform: string | null) => unknown };
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

describe('package', () => {
  it('AGENT_VERSION matches package.json', async () => {
    const { AGENT_VERSION } = await import('../src/version');
    expect(AGENT_VERSION).toBe((require('../package.json') as { version: string }).version);
  });
});
