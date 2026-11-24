import { ErrorCode, SEMANTIC_TYPES } from '@quiesco/protocol';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { DEFAULT_TAGS, constants, tagNames } from '../src/index';
import type { ColorScheme, Direction, ErrorName, HostErrorName, Permission, Platform, Tag } from '../src/index';
import { ErrorName as ErrorNames, HostErrorName as HostErrorNames, Platform as Platforms, SemanticType, Tag as Tags } from '../src/index';

describe('constants', () => {
  it('Tag holds the default tag names (what the platform filter reacts to)', () => {
    expect(Tags).toEqual(DEFAULT_TAGS);
    expect(tagNames()).toEqual({ ...Tags });
    expect(Tags.hardReset).toBe('@hard-reset');
  });

  it('every other constant maps a name to itself', () => {
    for (const [group, values] of Object.entries(constants)) {
      if (group === 'Tag') continue;
      for (const [key, value] of Object.entries(values)) expect(value, `${group}.${key}`).toBe(key);
    }
  });

  it('ErrorName covers the agent’s error codes and the host’s errors', () => {
    expect(Object.keys(ErrorNames).sort()).toEqual([...Object.keys(ErrorCode), ...Object.keys(HostErrorNames)].sort());
    expect(ErrorNames.ELEMENT_NOT_FOUND).toBe('ELEMENT_NOT_FOUND');
    expect(ErrorNames.APP_NOT_RUNNING).toBe('APP_NOT_RUNNING');
  });

  it('SemanticType lists SEMANTIC_TYPES', () => {
    expect(Object.keys(SemanticType)).toEqual([...SEMANTIC_TYPES]);
  });

  it('the constants are frozen together for the Jest global', () => {
    expect(Object.isFrozen(constants)).toBe(true);
    expect(constants.Platform).toBe(Platforms);
  });

  it('each constant is also the union type of its values', () => {
    expectTypeOf(Platforms.ios).toEqualTypeOf<'ios'>();
    expectTypeOf<Platform>().toEqualTypeOf<'ios' | 'android' | 'web'>();
    expectTypeOf<Direction>().toEqualTypeOf<'up' | 'down' | 'left' | 'right'>();
    expectTypeOf<ColorScheme>().toEqualTypeOf<'light' | 'dark'>();
    expectTypeOf<Permission>().toEqualTypeOf<'camera' | 'microphone' | 'location' | 'notifications' | 'contacts' | 'photos' | 'calendar'>();
    expectTypeOf(Tags.native).toEqualTypeOf<'@native'>();
    expectTypeOf<Tag>().toExtend<string>();
    expectTypeOf<HostErrorName>().toExtend<ErrorName>();
    expectTypeOf<'ELEMENT_NOT_FOUND'>().toExtend<ErrorName>();
  });
});
