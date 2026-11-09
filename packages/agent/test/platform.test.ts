import { describe, expect, it, vi } from 'vitest';

import { readColorScheme } from '../src/platform';

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
