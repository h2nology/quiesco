/**
 * Navigation state across soft resets (issue #1). Expo Router keeps the navigation state in its container,
 * outside the tree QuiescoRoot remounts, so a scenario that ends on a pushed screen used to hand that screen
 * to the next one. The runtime keeps the state the app started in and puts it back on every soft reset,
 * then checks that the app ended up on the route the first reset in this JS context ended on (D2).
 *
 * Only the navigation container ref is used (getRootState / resetRoot, React Navigation's public API), so
 * this works for any navigator inside Expo Router: stacks, tabs, drawers, nested.
 */

/** The part of a React Navigation state used here (structural, no import). */
export interface NavState {
  index?: number;
  routes: readonly { name: string; params?: object; state?: NavState | Partial<NavState> }[];
}

/**
 * The part of a NavigationContainerRef used here. React Navigation's container has `resetRoot(state)`; Expo
 * Router's fork of it (58) has not, only the navigation helpers, of which `reset(state)` dispatches
 * CommonActions.reset to the root navigator: with the whole root state, that replaces it, nested states
 * included.
 */
export interface NavigationRef {
  isReady(): boolean;
  getRootState(): NavState | undefined;
  resetRoot?(state?: NavState): void;
  reset?(state: NavState): void;
}

function resetRoot(ref: NavigationRef, state: NavState): void {
  if (typeof ref.resetRoot === 'function') ref.resetRoot(state);
  else if (typeof ref.reset === 'function') ref.reset(state);
  else throw new Error('the navigation container has neither resetRoot() nor reset()');
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

  /** Soft reset step: put the initial state back. Before the remount, so the remounted tree starts there. */
  restore(): void {
    const ref = this.ref;
    if (ref === null) return;
    this.capture();
    if (this.initial === null || !ref.isReady()) return;
    resetRoot(ref, this.initial);
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
    // A structured copy: the container's state objects are replaced, never mutated, but keep it independent.
    if (state !== undefined && state.routes.length > 0) this.initial = JSON.parse(JSON.stringify(state)) as NavState;
  }
}
