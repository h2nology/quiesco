import { describe, expect, it } from 'vitest';

import { NavigationReset, routePath } from '../src/navigation';
import type { NavState, NavigationRef } from '../src/navigation';

describe('routePath', () => {
  it('follows the focused routes and leaves out __root, groups and index', () => {
    expect(routePath({ routes: [{ name: '__root', state: { routes: [{ name: 'index' }] } }] })).toBe('/');
    const tabs: NavState = {
      routes: [{ name: '__root', state: { index: 0, routes: [{ name: '(tabs)', state: { index: 1, routes: [{ name: 'index' }, { name: 'settings/index' }] } }] } }],
    };
    expect(routePath(tabs)).toBe('/settings');
    // the last route when index is missing (a partial state), and params filled into dynamic segments
    expect(routePath({ routes: [{ name: 'index' }, { name: 'students/[id]', params: { id: 3 } }] })).toBe('/students/3');
    expect(routePath({ routes: [{ name: 'docs/[...slug]', params: { slug: ['a', 'b'] } }] })).toBe('/docs/a/b');
    expect(routePath({ routes: [{ name: 'students/[id]' }] })).toBe('/students/[id]');
    expect(routePath(undefined)).toBeNull();
    expect(routePath({ routes: [] })).toBeNull();
  });
});

describe('NavigationReset', () => {
  function fakeRef(start: NavState, ready = true) {
    const ref = {
      state: start,
      ready,
      resets: [] as (NavState | undefined)[],
      isReady: () => ref.ready,
      getRootState: () => ref.state,
      resetRoot: (s?: NavState) => {
        ref.resets.push(s);
        if (s !== undefined) ref.state = s;
      },
    };
    return ref satisfies NavigationRef;
  }
  const at = (...names: string[]): NavState => ({ index: names.length - 1, routes: names.map((name) => ({ name })) });

  it('keeps the first state it sees and restores it; remounts handing over the ref again do not replace it', () => {
    const nav = new NavigationReset();
    const ref = fakeRef(at('index'));
    const off = nav.setRef(ref);
    ref.state = at('index', 'students/new');
    off();
    nav.setRef(ref); // QuiescoRoot remounted
    expect(nav.current()).toBe('/students/new');
    nav.restore();
    expect(nav.current()).toBe('/');
    expect(ref.resets).toEqual([at('index')]);
  });

  it('captures at the first restore when the container was not ready when handed over', () => {
    const nav = new NavigationReset();
    const ref = fakeRef(at('index'), false);
    nav.setRef(ref);
    expect(nav.current()).toBeNull();
    ref.ready = true;
    nav.restore();
    expect(ref.resets).toEqual([at('index')]);
  });

  it('verify: the first reset sets the expected route, later ones must end there', () => {
    const nav = new NavigationReset();
    const ref = fakeRef(at('index', 'login')); // e.g. redirected on mount
    nav.setRef(ref);
    expect(nav.verify()).toEqual({ route: '/login', problem: null });
    expect(nav.verify()).toEqual({ route: '/login', problem: null });
    ref.state = at('index', 'students/new');
    expect(nav.verify().problem).toMatch(/on \/students\/new after the soft reset, not on its initial route \/login/);
  });

  it('resets with reset(state) when the container has no resetRoot, as in Expo Router 58', () => {
    const nav = new NavigationReset();
    const resets: NavState[] = [];
    let state = at('index');
    nav.setRef({ isReady: () => true, getRootState: () => state, reset: (s) => void resets.push(s) });
    state = at('index', 'details');
    nav.restore();
    expect(resets).toEqual([at('index')]);
    const bare = new NavigationReset();
    bare.setRef({ isReady: () => true, getRootState: () => state });
    expect(() => bare.restore()).toThrow(/neither resetRoot\(\) nor reset\(\)/);
  });

  it('does nothing without a ref', () => {
    const nav = new NavigationReset();
    expect(nav.active).toBe(false);
    nav.restore();
    expect(nav.current()).toBeNull();
    expect(nav.verify()).toEqual({ route: null, problem: null });
  });
});
