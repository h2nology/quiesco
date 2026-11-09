/**
 * `app.sync.*` (Phase 6.5): change what the app waits for at runtime — switch individual trackers or all
 * of them off, ignore more URLs / elements — instead of Detox's all-or-nothing switch (#1513). Changes
 * last until the end of the scenario (HU 2026-11-09): the session restores the config's values before
 * the next one. They survive relaunches and reconnects (the next `hello` carries them).
 */
import { TRACKER_NAMES } from '@quiesco/protocol';
import type { AgentConfig, Matcher, TextMatch, TrackerName } from '@quiesco/protocol';

import type { MatcherInput } from './matcher.js';
import { toMatcher, toTextMatch } from './matcher.js';

export interface SyncHost {
  /** The config's agent settings (what a scenario starts with). */
  base(): AgentConfig;
  /** Use `config` from now on: for the next hello, and on the open connection. */
  apply(config: AgentConfig): Promise<void>;
}

/** A list of extra / removed entries on top of the config's list. */
class ListOverride<T> {
  private readonly added = new Map<string, T>();
  private readonly removed = new Set<string>();

  constructor(private readonly key: (v: T) => string) {}

  add(v: T): void {
    const k = this.key(v);
    this.removed.delete(k);
    this.added.set(k, v);
  }

  remove(v: T): void {
    const k = this.key(v);
    this.added.delete(k);
    this.removed.add(k);
  }

  apply(base: readonly T[]): T[] {
    const out = base.filter((v) => !this.removed.has(this.key(v)));
    for (const [k, v] of this.added) if (!out.some((b) => this.key(b) === k)) out.push(v);
    return out;
  }

  get empty(): boolean {
    return this.added.size === 0 && this.removed.size === 0;
  }

  clear(): void {
    this.added.clear();
    this.removed.clear();
  }
}

const textKey = (m: TextMatch): string => JSON.stringify(m);
const matcherKey = (m: Matcher): string => JSON.stringify(m);

export class SyncApi {
  private allOff = false;
  private readonly trackers: Partial<Record<TrackerName, boolean>> = {};
  private readonly urls = new ListOverride<TextMatch>(textKey);
  private readonly elements = new ListOverride<Matcher>(matcherKey);

  /** `app.sync.ignoreUrls.add('/poll')` / `.remove(/analytics/)`: on top of the config's `sync.ignoreUrls`. */
  readonly ignoreUrls = {
    add: (pattern: string | RegExp): Promise<void> => {
      this.urls.add(toTextMatch(pattern));
      return this.push();
    },
    remove: (pattern: string | RegExp): Promise<void> => {
      this.urls.remove(toTextMatch(pattern));
      return this.push();
    },
  };

  /** Elements left out of the frame-stable check, on top of the config's `sync.ignoreElements`. */
  readonly ignoreElements = {
    add: (target: MatcherInput): Promise<void> => {
      this.elements.add(toMatcher(target));
      return this.push();
    },
    remove: (target: MatcherInput): Promise<void> => {
      this.elements.remove(toMatcher(target));
      return this.push();
    },
  };

  constructor(private readonly host: SyncHost) {}

  /** Stop waiting for the app altogether (every tracker off) until enable(). */
  disable(): Promise<void> {
    this.allOff = true;
    return this.push();
  }

  /** Wait for the app again (trackers as configured, with disableTracker / enableTracker changes). */
  enable(): Promise<void> {
    this.allOff = false;
    return this.push();
  }

  /** Ignore one source of busyness, e.g. `disableTracker('timer')` for a polling screen. */
  async disableTracker(name: TrackerName): Promise<void> {
    checkTracker(name);
    this.trackers[name] = false;
    return this.push();
  }

  async enableTracker(name: TrackerName): Promise<void> {
    checkTracker(name);
    this.trackers[name] = true;
    return this.push();
  }

  /** The agent config with this scenario's changes. */
  current(): AgentConfig {
    const base = this.host.base();
    const trackers: Partial<Record<TrackerName, boolean>> = this.allOff
      ? Object.fromEntries(TRACKER_NAMES.map((n) => [n, false]))
      : { ...base.sync.trackers, ...this.trackers };
    return {
      ...base,
      sync: {
        ...base.sync,
        trackers,
        ignoreUrls: this.urls.apply(base.sync.ignoreUrls),
        ignoreElements: this.elements.apply(base.sync.ignoreElements ?? []),
      },
    };
  }

  /** Whether anything differs from the config. */
  get changed(): boolean {
    return this.allOff || Object.keys(this.trackers).length > 0 || !this.urls.empty || !this.elements.empty;
  }

  /** Back to the config's values (before each scenario). */
  async reset(): Promise<void> {
    if (!this.changed) return;
    this.allOff = false;
    for (const k of Object.keys(this.trackers)) delete this.trackers[k as TrackerName];
    this.urls.clear();
    this.elements.clear();
    await this.push();
  }

  private push(): Promise<void> {
    return this.host.apply(this.current());
  }
}

function checkTracker(name: string): void {
  if (!(TRACKER_NAMES as readonly string[]).includes(name)) throw new RangeError(`unknown tracker "${name}" (${TRACKER_NAMES.join(', ')})`);
}
