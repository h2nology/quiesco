/**
 * Navigation state across soft resets (issue #1). Expo Router keeps the navigation state in its container,
 * outside the tree QuiescoRoot remounts, so a scenario that ends on a pushed screen used to hand that screen
 * to the next one. The runtime keeps the state the app started in and puts it back on every soft reset,
 * then checks that the app ended up on the route the first reset in this JS context ended on (D2).
 *
 * Only the navigation container ref is used (getRootState, dispatch / resetRoot: React Navigation's public
 * API), so this works for any navigator inside Expo Router: stacks, tabs, drawers, nested.
 */

/** The part of a React Navigation state used here (structural, no import). */
export interface NavState {
  /** The navigator's key (complete states only). */
  key?: string;
  index?: number;
  routes: readonly { name: string; params?: object; state?: NavState | Partial<NavState> }[];
}

/**
 * The part of a NavigationContainerRef used here. React Navigation's container has `resetRoot(state)`; Expo
 * Router's fork of it (58) has not. It has `dispatch`, and `reset(state)` for the root navigator.
 */
export interface NavigationRef {
  isReady(): boolean;
  getRootState(): NavState | undefined;
  resetRoot?(state?: NavState): void;
  reset?(state: NavState): void;
  dispatch?(action: { type: 'RESET'; payload: NavState; target?: string }): void;
}

/**
 * Put `initial` back. Expo Router 58 differs from React Navigation here:
 * - its root navigator (`navigator:root`, holding the `__root` route) does not handle RESET, so levels where
 *   both states have the same single route are skipped and the RESET goes to the first navigator below
 *   them, by key (`target`);
 * - RESET takes only a complete state matching that navigator ("Partial states can no longer be completed
 *   during render"), so the payload is the navigator's current state (key, routeNames, routeKeySeq, …) with
 *   the initial routes (names and params; the router mints their keys). Nested navigators below start over
 *   at their own initial screen.
 * An unhandled RESET is logged by React Navigation as a dev toast over the app, which covers elements.
 */
function resetTo(ref: NavigationRef, now: NavState, initial: NavState): void {
  let n: NavState | Partial<NavState> = now;
  let i: NavState = initial;
  for (;;) {
    const nr = n.routes?.[0];
    const ir = i.routes[0];
    if (n.routes?.length !== 1 || i.routes.length !== 1 || nr === undefined || ir === undefined || nr.name !== ir.name) break;
    if (nr.state?.key === undefined || ir.state === undefined) break;
    n = nr.state;
    i = ir.state as NavState;
  }
  const routeNames = (n as { routeNames?: unknown }).routeNames;
  if (n.key === undefined || !Array.isArray(routeNames) || typeof ref.dispatch !== 'function') {
    // Not Expo Router's tree (React Navigation's own container): the whole state, as the container takes it.
    if (typeof ref.resetRoot === 'function') ref.resetRoot(initial);
    else if (typeof ref.reset === 'function') ref.reset(initial);
    else throw new Error('the navigation container has neither resetRoot() nor reset()');
    return;
  }
  const unknown = i.routes.filter((r) => !routeNames.includes(r.name)).map((r) => r.name);
  if (unknown.length > 0) throw new Error(`the navigator has no route ${unknown.join(', ')} any more (routes: ${routeNames.join(', ')})`);
  const payload = {
    ...(n as NavState),
    stale: false,
    index: i.index ?? i.routes.length - 1,
    routes: i.routes.map((r) => ({ name: r.name, ...(r.params !== undefined ? { params: r.params } : {}) })),
  };
  ref.dispatch({ type: 'RESET', payload, target: n.key });
}

/**
 * The focused route as a path: `/students/new`, `/students/3` for `students/[id]` with `{ id: '3' }`, `/` for
 * the index. Groups `(tabs)`, `index` and Expo Router's `__root` are left out. Null without routes.
 */
export function routePath(state: NavState | Partial<NavState> | undefined): string | null {
  const segments: string[] = [];
  let s = state;
  let found = false;
  while (s?.routes !== undefined && s.routes.length > 0) {
    const route = s.routes[s.index ?? s.routes.length - 1];
    if (route === undefined) break;
    found = true;
    const params = (route.params ?? {}) as Record<string, unknown>;
    for (const part of route.name.split('/')) {
      if (part === '' || part === '__root' || part === 'index' || part === '_layout' || /^\(.*\)$/.test(part)) continue;
      const dynamic = /^\[(\.\.\.)?([^\]]+)\]$/.exec(part);
      const value = dynamic === null ? undefined : params[dynamic[2] as string];
      if (Array.isArray(value)) segments.push(...value.map(String));
      else segments.push(value === undefined || value === null ? part : String(value));
    }
    s = route.state;
  }
  return found ? `/${segments.join('/')}` : null;
}

/**
 * The state without the parts tied to one navigator instance (keys, `stale: false`, routeNames, type):
 * what `navigation.reset({ routes: [...] })` takes by hand. A complete state is only accepted by the
 * navigator it came from; the one taken at mount can belong to a navigator that is no longer mounted
 * (an app that renders its Stack only after loading something), and React Navigation then logs
 * "The action 'RESET' ... was not handled by any navigator" in a dev toast over the app.
 */
export function partialState(state: NavState | Partial<NavState>): NavState {
  const out: NavState = {
    routes: (state.routes ?? []).map((r) => ({
      name: r.name,
      ...(r.params !== undefined ? { params: r.params } : {}),
      ...(r.state !== undefined ? { state: partialState(r.state) } : {}),
    })),
  };
  if (state.index !== undefined) out.index = state.index;
  return out;
}

const RESET_POLL_MS = 16;
const RESET_WAIT_MS = 1000;

export class NavigationReset {
  private ref: NavigationRef | null = null;
  /** The state the app started in (this JS context), put back on every soft reset. */
  private initial: NavState | null = null;
  /** Where the first soft reset in this JS context left the app: later resets must end there too. */
  private expected: string | null = null;

  /** QuiescoRoot hands over Expo Router's container ref (null without Expo Router). */
  setRef(ref: NavigationRef | null): () => void {
    this.ref = ref;
    this.capture();
    return () => {
      if (this.ref === ref) this.ref = null;
    };
  }

  /** Whether there is a navigation container to reset. */
  get active(): boolean {
    return this.ref !== null;
  }

  /** The focused route now, or null without Expo Router (or before its container is ready). */
  current(): string | null {
    const ref = this.ref;
    if (ref === null || !ref.isReady()) return null;
    return routePath(ref.getRootState());
  }

  /**
   * Soft reset step: put the initial state back, before the remount so the remounted tree starts there.
   * Expo Router applies a dispatched action on its next render, so this waits for the state to change: a
   * remount first can unmount the target navigator (an app that renders its Stack only after loading).
   */
  async restore(sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
    const ref = this.ref;
    if (ref === null) return;
    this.capture();
    if (this.initial === null || !ref.isReady()) return;
    // Already there (e.g. the scenario never navigated): nothing to do.
    const now = ref.getRootState();
    if (now !== undefined && JSON.stringify(partialState(now)) === JSON.stringify(this.initial)) return;
    resetTo(ref, now ?? this.initial, this.initial);
    for (let waited = 0; ref.getRootState() === now; waited += RESET_POLL_MS) {
      if (waited >= RESET_WAIT_MS) throw new Error(`the navigator did not apply the reset within ${RESET_WAIT_MS}ms`);
      await sleep(RESET_POLL_MS);
    }
  }

  /**
   * After the reset settled: the route it ended on, or an error message when it differs from where the first
   * reset ended (the app did not get back to its initial state, e.g. it navigates on mount from state the
   * reset did not clear).
   */
  verify(): { route: string | null; problem: string | null } {
    const route = this.current();
    if (route === null) return { route, problem: null };
    if (this.expected === null) {
      this.expected = route;
      return { route, problem: null };
    }
    if (route === this.expected) return { route, problem: null };
    return {
      route,
      problem: `the app is on ${route} after the soft reset, not on its initial route ${this.expected}. Something the reset did not clear navigated away; clear it in quiesco.onReset(), or tag the scenario @hard-reset`,
    };
  }

  private capture(): void {
    const ref = this.ref;
    if (this.initial !== null || ref === null || !ref.isReady()) return;
    const state = ref.getRootState();
    // A copy (the container's state objects are replaced, never mutated) without instance keys.
    if (state !== undefined && state.routes.length > 0) this.initial = JSON.parse(JSON.stringify(partialState(state))) as NavState;
  }
}
