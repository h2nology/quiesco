import { describe, expect, it } from 'vitest';

import { decodeLaunchArgs, resolveParams } from '../src/connection/params';

const none = { native: null, global: {}, build: { port: null, session: null } };

describe('resolveParams', () => {
  it('prefers native launch params, then the web global, then the build fallback, then the default port', () => {
    expect(resolveParams({ ...none, native: { port: '7784', session: 's1' }, global: { __QUIESCO__: { port: 1, session: 'w' } } })).toEqual({ port: 7784, session: 's1', source: 'native' });
    expect(resolveParams({ ...none, global: { __QUIESCO__: { port: 7790, session: 'w' } } })).toEqual({ port: 7790, session: 'w', source: 'web-global' });
    expect(resolveParams({ ...none, build: { port: 7000, session: null } })).toEqual({ port: 7000, session: null, source: 'build' });
    expect(resolveParams(none)).toEqual({ port: 7357, session: null, source: 'default' });
  });

  it('ignores invalid ports', () => {
    expect(resolveParams({ ...none, native: { port: 'abc' }, global: { __QUIESCO__: { port: 70000 } } }).source).toBe('default');
  });
});

describe('decodeLaunchArgs', () => {
  const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64');
  const atob = (b: string) => Buffer.from(b, 'base64').toString('binary');

  it('decodes base64 JSON from the native launch parameter, keeping types (non-ASCII arrives escaped)', () => {
    // The host escapes non-ASCII as \uXXXX, so atob (Latin-1) is enough.
    const json = JSON.stringify({ name: '買い物' }).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    expect(decodeLaunchArgs(b64({ n: 1, b: false, o: { a: [1] } }), {}, atob)).toEqual({ args: { n: 1, b: false, o: { a: [1] } }, problem: null });
    expect(decodeLaunchArgs(b64(json), {}, atob)).toEqual({ args: { name: '買い物' }, problem: null });
  });

  it('reads the web global when there is no native parameter', () => {
    expect(decodeLaunchArgs(null, { __QUIESCO__: { port: 1, args: { x: 'y' } } }, atob)).toEqual({ args: { x: 'y' }, problem: null });
    expect(decodeLaunchArgs(undefined, {}, atob)).toEqual({ args: {}, problem: null });
  });

  it('reports malformed or non-object arguments', () => {
    expect(decodeLaunchArgs('%%%', {}, atob).problem).toMatch(/cannot decode/);
    expect(decodeLaunchArgs(b64([1, 2]), {}, atob)).toEqual({ args: {}, problem: 'launch arguments are not a JSON object' });
    expect(decodeLaunchArgs(null, { __QUIESCO__: { args: 'x' } }, atob).problem).toMatch(/not a JSON object/);
  });
});
