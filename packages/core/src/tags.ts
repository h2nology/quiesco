/**
 * Scenario tags understood by Quiesco (requirements.md §6.10), shared by all runner adapters.
 * - Platform tags: a scenario carrying any of them runs only on the listed platforms
 *   (`@native` = ios + android). Untagged scenarios run everywhere. When several Gherkin levels carry
 *   platform tags (feature, rule, scenario, examples), the innermost one decides.
 * - Hard reset tag: relaunch the app instead of a soft reset.
 */
import type { Platform } from '@quiesco/protocol';

export interface TagNames {
  ios: string;
  android: string;
  web: string;
  native: string;
  hardReset: string;
}

/**
 * A scenario's tags: a flat list (one level), or grouped by Gherkin level, outermost first
 * (feature, rule, scenario, examples).
 */
export type ScenarioTags = readonly string[] | readonly (readonly string[])[];

export const DEFAULT_TAGS: TagNames = { ios: '@ios', android: '@android', web: '@web', native: '@native', hardReset: '@hard-reset' };

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

/**
 * Whether a scenario with `tags` runs on `platform`: the innermost level with a platform tag decides
 * (a `@android` scenario in a `@native` feature runs on Android only); no platform tag at any level
 * means everywhere.
 */
export function runsOnPlatform(tags: ScenarioTags, platform: Platform, names: TagNames = DEFAULT_TAGS): boolean {
  const levels = isLeveled(tags) ? tags : [tags as readonly string[]];
  for (let i = levels.length - 1; i >= 0; i--) {
    const allowed = platformsOf(levels[i] ?? [], names);
    if (allowed.size > 0) return allowed.has(platform);
  }
  return true;
}
