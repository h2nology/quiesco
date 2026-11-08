import type { Matcher } from './matcher.js';

export type ActionMode = 'native' | 'js';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Speed = 'slow' | 'normal' | 'fast';

/** A point: in an element's own coordinates (`point`) or in window coordinates (`tapAt`), logical units. */
export interface Point {
  x: number;
  y: number;
}

/** Keys of the software keyboard that `pressKey` can send. */
export type KeyName = 'enter' | 'backspace';

/** Edges for `scrollToEdge`. */
export type Edge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Actions from requirements.md §6.3 (extended in Phase 6.2).
 * - `point`: where to touch inside the element (default: its center).
 * - `from`: start of a scroll / swipe inside the element, normalized 0–1 (default: around the center).
 * - `distance`: finger travel in logical units.
 */
export type ActionSpec =
  | { type: 'tap'; matcher: Matcher; point?: Point }
  | { type: 'longPress'; matcher: Matcher; durationMs?: number; point?: Point }
  | { type: 'doubleTap'; matcher: Matcher }
  | { type: 'multiTap'; matcher: Matcher; count: number }
  | { type: 'type'; matcher: Matcher; text: string }
  | { type: 'replaceText'; matcher: Matcher; text: string }
  | { type: 'clear'; matcher: Matcher }
  | { type: 'pressKey'; matcher: Matcher; key: KeyName }
  | { type: 'scroll'; matcher: Matcher; direction: Direction; distance?: number; from?: Point }
  | { type: 'scrollTo'; container: Matcher; target: Matcher }
  | { type: 'scrollToEdge'; matcher: Matcher; edge: Edge }
  /** `viewPosition`: 0 = row at the top of the list, 0.5 = middle, 1 = bottom. */
  | { type: 'scrollToIndex'; matcher: Matcher; index: number; viewPosition?: number }
  | { type: 'swipe'; matcher: Matcher; direction: Direction; speed?: Speed; distance?: number; from?: Point }
  /** Press and hold `holdMs`, then move to the center of the `to` element or to a window point. */
  | { type: 'drag'; matcher: Matcher; to: { matcher: Matcher } | { point: Point }; holdMs?: number; speed?: Speed }
  /** Window coordinates, no element (Detox `device.tap(point)`). */
  | { type: 'tapAt'; point: Point }
  | { type: 'longPressAt'; point: Point; durationMs?: number }
  | { type: 'pressBack' }
  | { type: 'openUrl'; url: string }
  | { type: 'dismissKeyboard' };

export type ActionType = ActionSpec['type'];

/**
 * Real input that the HOST must inject (web `native` mode: Playwright mouse/keyboard).
 * Coordinates are window coordinates in the platform's logical units.
 */
export type HostInput =
  | { kind: 'tap'; x: number; y: number; count?: number; holdMs?: number }
  | { kind: 'type'; x: number; y: number; text: string; clearFirst?: boolean }
  /** Press at `from`, hold `holdMs`, move to `to` over `durationMs`, release. */
  | { kind: 'drag'; from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number; holdMs?: number }
  /** Mouse wheel at (x, y); positive `dy` scrolls content down (reveals what is below). */
  | { kind: 'wheel'; x: number; y: number; dx: number; dy: number }
  /** Press a key on the focused element (Playwright key name, e.g. `Enter`, `Backspace`). */
  | { kind: 'key'; key: string }
  | { kind: 'navigate'; url: string }
  | { kind: 'back' };
