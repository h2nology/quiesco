/**
 * The fixed strings a test writes, as constants (each one a type as well, of the same name):
 *
 *   test(`logs in ${Tag.ios}`, …);
 *   test('Face ID', { tags: [Tag.native, Tag.hardReset] }, …);
 *   await app.swipe('card', Direction.left, { speed: Speed.fast });
 *   await app.device.setPermission(Permission.camera, PermissionState.grant);
 *   if (e.errorName === ErrorName.APP_NOT_RUNNING) …
 *
 * The runner packages re-export them (`@quiesco/vitest`, `@quiesco/cucumber`, `@quiesco/jest`); Jest
 * tests also find them on the `quiesco` global (`quiesco.Tag.ios`).
 */
import { ActionMode, AppStateName, Direction, Edge, KeyName, Orientation, Platform, SemanticType, Speed } from '@quiesco/protocol';
import { AppRunState, NetworkState } from './device.js';
import { ColorScheme } from './devices/provider.js';
import { Permission, PermissionState } from './devices/permissions.js';
import { ErrorName } from './errors.js';
import { Tag, WebBrowser } from './tags.js';

export { ActionMode, AppRunState, AppStateName, ColorScheme, Direction, Edge, ErrorName, KeyName, NetworkState, Orientation, Permission, PermissionState, Platform, SemanticType, Speed, Tag, WebBrowser };

/** All of the constants in one object (what the Jest environment puts on the `quiesco` global). */
export const constants = Object.freeze({
  ActionMode,
  AppRunState,
  AppStateName,
  ColorScheme,
  Direction,
  Edge,
  ErrorName,
  KeyName,
  NetworkState,
  Orientation,
  Permission,
  PermissionState,
  Platform,
  SemanticType,
  Speed,
  Tag,
  WebBrowser,
});
export type QuiescoConstants = typeof constants;
