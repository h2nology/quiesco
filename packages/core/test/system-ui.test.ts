import { describe, expect, it } from 'vitest';

import type { SystemNode } from '../src/devices/provider';
import { checkSystemQuery, describeSystemQuery, matchesSystemQuery, seenTexts } from '../src/system-ui';

const node = (text: string, id = ''): SystemNode => ({ text, id, bounds: { x1: 0, y1: 0, x2: 10, y2: 10 } });

describe('system UI queries (6.7 batch C)', () => {
  it('matches text exactly, ignoring typographic quotes and surrounding spaces', () => {
    expect(matchesSystemQuery(node('Don’t allow'), { text: "Don't allow" })).toBe(true);
    expect(matchesSystemQuery(node(' Allow '), { text: 'Allow' })).toBe(true);
    expect(matchesSystemQuery(node('Allow all'), { text: 'Allow' })).toBe(false);
  });

  it('matches a RegExp, also one with the g flag on repeated calls', () => {
    const re = /^allow/gi;
    expect(matchesSystemQuery(node('Allow'), { text: re })).toBe(true);
    expect(matchesSystemQuery(node('Allow'), { text: re })).toBe(true);
    expect(matchesSystemQuery(node('Deny'), { text: re })).toBe(false);
  });

  it('matches the full id or the part after ":id/", and needs every given field', () => {
    const n = node('取消', 'com.android.systemui:id/button_negative');
    expect(matchesSystemQuery(n, { id: 'com.android.systemui:id/button_negative' })).toBe(true);
    expect(matchesSystemQuery(n, { id: 'button_negative' })).toBe(true);
    expect(matchesSystemQuery(n, { id: 'negative' })).toBe(false);
    expect(matchesSystemQuery(n, { id: 'button_negative', text: '取消' })).toBe(true);
    expect(matchesSystemQuery(n, { id: 'button_negative', text: 'Cancel' })).toBe(false);
  });

  it('rejects empty queries and describes them for messages', () => {
    expect(() => checkSystemQuery('system.tap', {})).toThrow(TypeError);
    expect(() => checkSystemQuery('system.tap', { text: '' })).toThrow(TypeError);
    expect(() => checkSystemQuery('system.tap', null as never)).toThrow(TypeError);
    expect(() => checkSystemQuery('system.tap', { text: /x/ })).not.toThrow();
    expect(describeSystemQuery({ text: 'OK', id: 'ok' })).toBe('{ text: "OK", id: "ok" }');
    expect(describeSystemQuery({ text: /ok/i })).toBe('{ text: /ok/i }');
    expect(seenTexts([node('A'), node(''), node('A'), node('B')])).toEqual(['A', 'B']);
  });
});
