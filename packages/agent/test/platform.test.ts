import { describe, expect, it, vi } from 'vitest';

import { preferredLanguages, readColorScheme } from '../src/platform';

describe('readColorScheme', () => {
  it('asks a fresh MediaQueryList where matchMedia exists, never the app\'s Appearance (its list would swallow the change event)', () => {
    const appearance = vi.fn(() => 'light');
    const lists: string[] = [];
    const matchMedia = (q: string) => {
      lists.push(q);
      return { matches: true };
    };
    expect(readColorScheme(matchMedia, appearance)).toBe('dark');
    expect(readColorScheme(matchMedia, appearance)).toBe('dark');
    expect(lists).toEqual(['(prefers-color-scheme: dark)', '(prefers-color-scheme: dark)']);
    expect(appearance).not.toHaveBeenCalled();
  });

  it('uses React Native\'s Appearance without matchMedia (native)', () => {
    expect(readColorScheme(undefined, () => 'dark')).toBe('dark');
    expect(readColorScheme(undefined, () => null)).toBeNull();
    expect(readColorScheme(undefined, () => 'unspecified')).toBeNull();
  });
});

describe('preferredLanguages (#53)', () => {
  it('reads iOS AppleLanguages from SettingsManager (TurboModule, else NativeModules); nothing elsewhere', () => {
    const settings = { AppleLanguages: ['fr-FR', 'en'], AppleLocale: 'fr_FR' };
    expect(preferredLanguages({ TurboModuleRegistry: { get: () => ({ getConstants: () => ({ settings }) }) } })).toEqual({ preferredLanguages: ['fr-FR', 'en'] });
    expect(preferredLanguages({ TurboModuleRegistry: { get: () => null }, NativeModules: { SettingsManager: { settings } } })).toEqual({ preferredLanguages: ['fr-FR', 'en'] });
    // Android / web: no SettingsManager.
    expect(preferredLanguages({ TurboModuleRegistry: { get: () => null }, NativeModules: {} })).toEqual({});
    expect(
      preferredLanguages({
        TurboModuleRegistry: {
          get: () => {
            throw new Error('not registered');
          },
        },
      }),
    ).toEqual({});
  });
});
