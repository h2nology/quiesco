import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { toControlValue } from '../src/driver';
import { findNonJson, isDate, isPlainObject, isRegExp } from '../src/json';
import { checkLaunchArgs } from '../src/launch-args';
import { checkSystemQuery, describeSystemQuery, matchesSystemQuery } from '../src/system-ui';

/** Values made in another realm, like the ones a Jest test file passes in (each file runs in its own vm context). */
const foreign = runInNewContext(`({
  todos: [{ title: 'Buy milk', tags: ['a'] }, { title: 'Call the dentist', notes: null }],
  bare: Object.create(null),
  regex: /^allow/i,
  date: new Date(Date.UTC(2031, 11, 24)),
  map: new Map(),
  instance: new (class Todo { constructor() { this.title = 'x'; } })(),
})`) as {
  todos: object[];
  bare: object;
  regex: RegExp;
  date: Date;
  map: Map<string, string>;
  instance: object;
};

describe('values from another realm (issue #115: Jest runs each test file in its own vm context)', () => {
  it('the values really are foreign', () => {
    expect(Object.getPrototypeOf(foreign.todos[0])).not.toBe(Object.prototype);
    expect(foreign.regex instanceof RegExp).toBe(false);
    expect(foreign.date instanceof Date).toBe(false);
  });

  it('object literals are plain objects, class instances and Maps are not', () => {
    expect(isPlainObject(foreign.todos[0]!)).toBe(true);
    expect(isPlainObject(foreign.bare)).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(foreign.instance)).toBe(false);
    expect(isPlainObject(foreign.map)).toBe(false);
    expect(isPlainObject(new (class {})())).toBe(false);
  });

  it('findNonJson accepts object literals (backdoor and webview arguments)', () => {
    expect(findNonJson([foreign.todos], '$args')).toBeNull();
    expect(findNonJson(foreign.bare)).toBeNull();
    expect(findNonJson({ when: foreign.date })).toEqual({ path: '$.when', reason: 'Date instance (only plain objects and arrays)' });
    expect(findNonJson([foreign.instance])).toEqual({ path: '$[0]', reason: 'Todo instance (only plain objects and arrays)' });
    expect(findNonJson(foreign.map)?.reason).toMatch(/^Map instance/);
  });

  it('launch arguments accept object literals', () => {
    const args = runInNewContext(`({ user: { name: 'Ann' }, flags: ['beta'] })`) as object;
    expect(checkLaunchArgs(args, 'relaunch({ args })')).toBe(args);
  });

  it('RegExp and Date are recognized', () => {
    expect(isRegExp(foreign.regex)).toBe(true);
    expect(isRegExp('x')).toBe(false);
    expect(isDate(foreign.date)).toBe(true);
    expect(isDate(foreign.date.getTime())).toBe(false);
    expect(toControlValue(foreign.date)).toEqual({ date: '2031-12-24T00:00:00.000Z' });
  });

  it('system UI queries take a RegExp text', () => {
    const q = { text: foreign.regex };
    expect(() => checkSystemQuery('tapSystem', q)).not.toThrow();
    expect(matchesSystemQuery({ id: '', text: 'Allow Once' } as Parameters<typeof matchesSystemQuery>[0], q)).toBe(true);
    expect(describeSystemQuery(q)).toBe('{ text: /^allow/i }');
  });
});
