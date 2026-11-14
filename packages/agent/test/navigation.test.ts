import { describe, expect, it } from 'vitest';

import { NavigationReset, partialState, routePath } from '../src/navigation';
import type { NavState, NavigationRef } from '../src/navigation';

describe('routePath', () => {
  it('follows the focused routes and leaves out __root, groups and index', async () => {
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

describe('partialState', () => {
  it('keeps names, params, nesting and index; drops keys, stale, routeNames and type', async () => {
    const full = {
      key: 'root-1', stale: false, type: 'stack', routeNames: ['__root'], index: 0,
      routes: [{ key: '__root-x', name: '__root', state: { key: 's-2', stale: false, index: 1, routeNames: ['index', 'details'], routes: [{ key: 'i', name: 'index' }, { key: 'd', name: 'details', params: { id: '3' } }] } }],
    } as unknown as NavState;
    expect(partialState(full)).toEqual({ index: 0, routes: [{ name: '__root', state: { index: 1, routes: [{ name: 'index' }, { name: 'details', params: { id: '3' } }] } }] });
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
  const now = () => Promise.resolve();

  it('does not reset when the app is already in its initial state', async () => {
    const nav = new NavigationReset();
    const ref = fakeRef(at('index'));
    nav.setRef(ref);
    await nav.restore(now);
    expect(ref.resets).toEqual([]);
  });

  it('keeps the first state it sees and restores it; remounts handing over the ref again do not replace it', async () => {
    const nav = new NavigationReset();
    const ref = fakeRef(at('index'));
    const off = nav.setRef(ref);
    ref.state = at('index', 'students/new');
    off();
    nav.setRef(ref); // QuiescoRoot remounted
    expect(nav.current()).toBe('/students/new');
    await nav.restore(now);
    expect(nav.current()).toBe('/');
    expect(ref.resets).toEqual([at('index')]);
  });

  it('captures at the first restore when the container was not ready when handed over', async () => {
    const nav = new NavigationReset();
    const ref = fakeRef(at('index'), false);
    nav.setRef(ref);
    expect(nav.current()).toBeNull();
    ref.ready = true;
    await nav.restore(now); // captures now: already there
    expect(ref.resets).toEqual([]);
    ref.state = at('index', 'details');
    await nav.restore(now);
    expect(ref.resets).toEqual([at('index')]);
  });

  it('verify: the first reset sets the expected route, later ones must end there', async () => {
    const nav = new NavigationReset();
    const ref = fakeRef(at('index', 'login')); // e.g. redirected on mount
    nav.setRef(ref);
    expect(nav.verify()).toEqual({ route: '/login', problem: null });
    expect(nav.verify()).toEqual({ route: '/login', problem: null });
    ref.state = at('index', 'students/new');
    expect(nav.verify().problem).toMatch(/on \/students\/new after the soft reset, not on its initial route \/login/);
  });

  it('resets with reset(state) when the container has no resetRoot, as in Expo Router 58', async () => {
    const nav = new NavigationReset();
    const resets: NavState[] = [];
    let state = at('index');
    nav.setRef({ isReady: () => true, getRootState: () => state, reset: (s) => { resets.push(s); state = s; } });
    state = at('index', 'details');
    await nav.restore(now);
    expect(resets).toEqual([at('index')]);
    const bare = new NavigationReset();
    const start = state;
    bare.setRef({ isReady: () => true, getRootState: () => state });
    state = at('index', 'other');
    expect(start).not.toEqual(state);
    await expect(bare.restore(now)).rejects.toThrow(/neither resetRoot\(\) nor reset\(\)/);
  });

  it('sends a complete RESET past Expo Router\'s root wrapper to the first real navigator, by key', async () => {
    const nav = new NavigationReset();
    const actions: unknown[] = [];
    const stack = { key: 'navigator:0', stale: false, type: 'stack', routeNames: ['index', 'todos', 'details'], routeKeySeq: 2 };
    let state = { key: 'navigator:root', index: 0, routes: [{ name: '__root', state: { ...stack, index: 0, routes: [{ name: 'index' }] } }] } as unknown as NavState;
    nav.setRef({ isReady: () => true, getRootState: () => state, dispatch: (a) => { actions.push(a); state = { ...state }; }, reset: () => actions.push('root reset') });
    state = { key: 'navigator:root', index: 0, routes: [{ name: '__root', state: { ...stack, routeKeySeq: 5, index: 1, routes: [{ key: 'todos:0-1', name: 'todos' }, { key: 'details:0-4', name: 'details', state: { key: 'x', routes: [] } }] } }] } as unknown as NavState;
    await nav.restore(now);
    expect(actions).toEqual([{ type: 'RESET', payload: { ...stack, routeKeySeq: 5, index: 0, routes: [{ name: 'index' }] }, target: 'navigator:0' }]);
  });

  it('refuses routes the navigator no longer has', async () => {
    const nav = new NavigationReset();
    let state = { key: 'r', routes: [{ name: '__root', state: { key: 's', routeNames: ['index'], index: 0, routes: [{ name: 'gone' }] } }] } as unknown as NavState;
    nav.setRef({ isReady: () => true, getRootState: () => state, dispatch: () => {} });
    state = { key: 'r', routes: [{ name: '__root', state: { key: 's', routeNames: ['index'], index: 0, routes: [{ name: 'index' }] } }] } as unknown as NavState;
    await expect(nav.restore(now)).rejects.toThrow(/has no route gone any more \(routes: index\)/);
  });

  it('waits for the navigator to apply the RESET (Expo Router applies it on its next render), and gives up after 1s', async () => {
    const nav = new NavigationReset();
    let state = at('index');
    let pending: NavState | null = null;
    nav.setRef({ isReady: () => true, getRootState: () => state, resetRoot: (s) => void (pending = s ?? null) });
    state = at('index', 'details');
    let renders = 0;
    await nav.restore(async () => {
      if (++renders === 3 && pending !== null) state = pending; // applied on a later render
    });
    expect(renders).toBe(3);
    expect(state).toEqual(at('index'));
    state = at('index', 'details');
    pending = null;
    await expect(nav.restore(now)).rejects.toThrow(/did not apply the reset within 1000ms/);
  });

  it('does nothing without a ref', async () => {
    const nav = new NavigationReset();
    expect(nav.active).toBe(false);
    await nav.restore(now);
    expect(nav.current()).toBeNull();
    expect(nav.verify()).toEqual({ route: null, problem: null });
  });
});
