import { describe, expect, it } from 'vitest';

import { MESSAGES, detectLocale, translator } from '../web/src/i18n';
import type { MessageKey } from '../web/src/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('UI languages', () => {
  it('detects the language: the saved choice, else the browser’s first of zh / ja / en, else English', () => {
    expect(detectLocale('ja', ['zh-CN'])).toBe('ja');
    expect(detectLocale(null, ['fr-FR', 'zh-TW', 'en'])).toBe('zh');
    expect(detectLocale(null, ['ja-JP'])).toBe('ja');
    expect(detectLocale('xx', ['de-DE'])).toBe('en');
  });

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(translator('zh')('nPassed', { n: 3 })).toBe('3 通过');
    expect(translator('ja')('ringLabel', { done: 2, total: 5, failed: 1 })).toBe('5 件中 2 件完了、失敗 1 件');
    expect(translator('en')('device', {})).toBe('Device {n}');
  });

  it('every language has every message, none empty, with the same placeholders as English', () => {
    const keys = Object.keys(MESSAGES.en) as MessageKey[];
    for (const [locale, dict] of Object.entries(MESSAGES)) {
      expect(Object.keys(dict).sort(), locale).toEqual([...keys].sort());
      for (const k of keys) {
        expect(dict[k].trim(), `${locale}.${k}`).not.toBe('');
        expect(placeholders(dict[k]), `${locale}.${k}`).toEqual(placeholders(MESSAGES.en[k]));
      }
    }
  });
});
