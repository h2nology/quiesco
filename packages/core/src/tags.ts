/**
 * Scenario tags understood by Quiesco (requirements.md §6.10), shared by all runner adapters.
 * - Platform tags: a scenario carrying any of them runs only on the listed platforms
 *   (`@native` = ios + android). Untagged scenarios run everywhere.
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

export const DEFAULT_TAGS: TagNames = { ios: '@ios', android: '@android', web: '@web', native: '@native', hardReset: '@hard-reset' };

export function tagNames(overrides: Partial<TagNames> = {}): TagNames {
  return { ...DEFAULT_TAGS, ...overrides };
}

/** Whether a scenario with `tags` runs on `platform`. */
export function runsOnPlatform(tags: readonly string[], platform: Platform, names: TagNames = DEFAULT_TAGS): boolean {
  const allowed = new Set<Platform>();
  if (tags.includes(names.ios)) allowed.add('ios');
  if (tags.includes(names.android)) allowed.add('android');
  if (tags.includes(names.web)) allowed.add('web');
  if (tags.includes(names.native)) {
    allowed.add('ios');
    allowed.add('android');
  }
  return allowed.size === 0 || allowed.has(platform);
}
