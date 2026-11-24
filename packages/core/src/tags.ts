/**
 * Scenario tags understood by Quiesco (requirements.md §6.10), shared by all runner adapters.
 * - Platform tags: a scenario carrying any of them runs only on the listed platforms
 *   (`@native` = ios + android). Untagged scenarios run everywhere. When several Gherkin levels carry
 *   platform tags (feature, rule, scenario, examples), the innermost one decides.
 * - Browser tags (`@chromium` `@firefox` `@webkit`): on web, a scenario carrying any of them runs only
 *   in the listed browsers (`devices.web.browser`); iOS and Android ignore them. Same innermost-level
 *   rule, decided apart from the platform tags (`@web @webkit` = web, WebKit only).
 * - Hard reset tag: relaunch the app instead of a soft reset.
 */
import type { Platform } from '@quiesco/protocol';

/** The browsers of `devices.web.browser`. */
export const WebBrowser = { chromium: 'chromium', firefox: 'firefox', webkit: 'webkit' } as const;
export type WebBrowser = (typeof WebBrowser)[keyof typeof WebBrowser];

export interface TagNames {
  ios: string;
  android: string;
  web: string;
  native: string;
  chromium: string;
  firefox: string;
  webkit: string;
  hardReset: string;
}

/**
 * A scenario's tags: a flat list (one level), or grouped by Gherkin level, outermost first
 * (feature, rule, scenario, examples).
 */
export type ScenarioTags = readonly string[] | readonly (readonly string[])[];

/**
 * The tags Quiesco reacts to, under their default names: `` test(`logs in ${Tag.ios}`, …) ``,
 * `{ tags: [Tag.native, Tag.hardReset] }`. A project that renames them (`tags` in the config) passes
 * its own names instead.
 */
export const Tag = {
  ios: '@ios',
  android: '@android',
  web: '@web',
  native: '@native',
  chromium: '@chromium',
  firefox: '@firefox',
  webkit: '@webkit',
  hardReset: '@hard-reset',
} as const satisfies TagNames;
export type Tag = (typeof Tag)[keyof typeof Tag];

export const DEFAULT_TAGS: TagNames = Tag;

export function tagNames(overrides: Partial<TagNames> = {}): TagNames {
  return { ...DEFAULT_TAGS, ...overrides };
}

function isLeveled(tags: ScenarioTags): tags is readonly (readonly string[])[] {
  return tags.some((t) => Array.isArray(t));
}

/** All tags of a scenario, outermost level first. */
export function flattenTags(tags: ScenarioTags): string[] {
  return isLeveled(tags) ? tags.flat() : [...tags];
}

function platformsOf(tags: readonly string[], names: TagNames): Set<Platform> {
  const allowed = new Set<Platform>();
  if (tags.includes(names.ios)) allowed.add('ios');
  if (tags.includes(names.android)) allowed.add('android');
  if (tags.includes(names.web)) allowed.add('web');
  if (tags.includes(names.native)) {
    allowed.add('ios');
    allowed.add('android');
  }
  return allowed;
}

function browsersOf(tags: readonly string[], names: TagNames): Set<WebBrowser> {
  return new Set((['chromium', 'firefox', 'webkit'] as const).filter((b) => tags.includes(names[b])));
}

/** The innermost level whose `pick` is not empty decides whether `value` is in it; none means yes. */
function innermost<T>(tags: ScenarioTags, pick: (level: readonly string[]) => Set<T>, value: T): boolean {
  const levels = isLeveled(tags) ? tags : [tags as readonly string[]];
  for (let i = levels.length - 1; i >= 0; i--) {
    const allowed = pick(levels[i] ?? []);
    if (allowed.size > 0) return allowed.has(value);
  }
  return true;
}

/**
 * Whether a scenario with `tags` runs on `platform`: the innermost level with a platform tag decides
 * (a `@android` scenario in a `@native` feature runs on Android only); no platform tag at any level
 * means everywhere. On web with `browser` given, the innermost level with a browser tag decides too.
 */
export function runsOnPlatform(tags: ScenarioTags, platform: Platform, names: TagNames = DEFAULT_TAGS, browser?: WebBrowser): boolean {
  if (!innermost(tags, (level) => platformsOf(level, names), platform)) return false;
  return platform !== 'web' || browser === undefined || innermost(tags, (level) => browsersOf(level, names), browser);
}
