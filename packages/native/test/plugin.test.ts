import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('../app.plugin.js') as {
  excludeFromSettingsGradle(src: string): string;
  networkSecurityXml(kind: 'localhost' | 'all'): string;
  isE2E(env: Record<string, string | undefined>): boolean;
};

const SETTINGS = `plugins {\n  id("expo-autolinking-settings")\n}\nexpoAutolinking.useExpoModules()\n\nrootProject.name = 'App'\n`;

describe('@quiesco/native config plugin', () => {
  it('excludes the module from autolinking before useExpoModules(), once', () => {
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

  it('is an e2e build only with EXPO_PUBLIC_QUIESCO=1', () => {
    expect(plugin.isE2E({ EXPO_PUBLIC_QUIESCO: '1' })).toBe(true);
    expect(plugin.isE2E({})).toBe(false);
  });
});
