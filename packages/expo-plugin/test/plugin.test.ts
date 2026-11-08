import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type Config = { name: string; slug: string; mods?: Record<string, Record<string, unknown>> };
const plugin = require('../app.plugin.js') as ((config: Config, options?: { env?: Record<string, string | undefined> }) => Config) & {
  isE2E(env: Record<string, string | undefined>): boolean;
  excludeFromSettingsGradle(src: string): string;
  excludeFromPodfile(src: string): string;
  networkSecurityXml(kind: 'localhost' | 'all'): string;
  allowLocalNetworking(plist: Record<string, unknown>): Record<string, unknown>;
};

const SETTINGS = `plugins {\n  id("expo-autolinking-settings")\n}\nexpoAutolinking.useExpoModules()\n\nrootProject.name = 'App'\n`;
// The relevant part of the Podfile `expo prebuild` generates (SDK 58).
const PODFILE = `target 'App' do\n  use_expo_modules!\n\n  if ENV['EXPO_USE_COMMUNITY_AUTOLINKING'] == '1'\n    config_command = ['node', '--no-warnings']\n  end\nend\n`;

const base = (): Config => ({ name: 'App', slug: 'app' });
const modsOf = (c: Config): string[] =>
  Object.entries(c.mods ?? {})
    .flatMap(([platform, mods]) => Object.keys(mods).map((m) => `${platform}.${m}`))
    .sort();

describe('@quiesco/expo-plugin', () => {
  it('is an e2e build only with EXPO_PUBLIC_QUIESCO=1', () => {
    expect(plugin.isE2E({ EXPO_PUBLIC_QUIESCO: '1' })).toBe(true);
    expect(plugin.isE2E({ EXPO_PUBLIC_QUIESCO: 'true' })).toBe(false);
    expect(plugin.isE2E({})).toBe(false);
  });

  it('production builds: only excludes @quiesco/native from autolinking (Podfile, settings.gradle)', () => {
    expect(modsOf(plugin(base(), { env: {} }))).toEqual(['android.settingsGradle', 'ios.podfile']);
  });

  it('e2e builds: keeps the module and only configures local networking (manifest + xml, Info.plist)', () => {
    expect(modsOf(plugin(base(), { env: { EXPO_PUBLIC_QUIESCO: '1' } }))).toEqual(['android.dangerous', 'android.manifest', 'ios.infoPlist']);
  });

  describe('Android', () => {
    it('excludes the module before useExpoModules(), once', () => {
      const once = plugin.excludeFromSettingsGradle(SETTINGS);
      expect(once).toContain('expoAutolinking.exclude = ["@quiesco/native"]\nexpoAutolinking.useExpoModules()');
      expect(plugin.excludeFromSettingsGradle(once)).toBe(once);
    });

    it('fails loudly when settings.gradle has no autolinking call', () => {
      expect(() => plugin.excludeFromSettingsGradle('rootProject.name = "x"')).toThrow(/useExpoModules/);
    });

    it('allows cleartext to localhost only (release) or everything (debug)', () => {
      const local = plugin.networkSecurityXml('localhost');
      expect(local).toContain('<domain includeSubdomains="false">localhost</domain>');
      expect(local).toContain('<domain includeSubdomains="false">127.0.0.1</domain>');
      expect(local).not.toContain('base-config');
      expect(plugin.networkSecurityXml('all')).toContain('<base-config cleartextTrafficPermitted="true" />');
    });
  });

  describe('iOS', () => {
    it('passes exclude: to use_expo_modules!, keeping the indentation, once', () => {
      const once = plugin.excludeFromPodfile(PODFILE);
      expect(once).toContain("\n  use_expo_modules!(exclude: ['@quiesco/native'])\n");
      expect(once).not.toMatch(/^\s*use_expo_modules!\s*$/m);
      expect(plugin.excludeFromPodfile(once)).toBe(once);
    });

    it('fails loudly on a customized use_expo_modules! call instead of guessing', () => {
      expect(() => plugin.excludeFromPodfile("  use_expo_modules!(exclude: ['other'])\n")).toThrow(/exclude: \['@quiesco\/native'\]/);
      expect(() => plugin.excludeFromPodfile("target 'App' do\nend\n")).toThrow(/use_expo_modules!/);
    });

    it('allows local networking in ATS and keeps the other ATS keys', () => {
      expect(plugin.allowLocalNetworking({})).toEqual({ NSAppTransportSecurity: { NSAllowsLocalNetworking: true } });
      expect(plugin.allowLocalNetworking({ CFBundleName: 'App', NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false } })).toEqual({
        CFBundleName: 'App',
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true },
      });
    });
  });
});
