import { describe, expect, it } from 'vitest';

import { resolveParams } from '../src/connection/params';

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
