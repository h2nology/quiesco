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

/** A finger's position at a time: ms from the start of the gesture. */
export interface TimedPoint {
  x: number;
  y: number;
  t: number;
}

/** A date in JSON: ISO 8601 (`Date.prototype.toISOString()`). */
export interface DateValue {
  date: string;
}

/**
 * What `setValue` sets (Phase 6.3): a number (slider), a boolean (switch, checkbox), a string (picker item
 * value or label, segment value) or a date (date / time picker, `<input type="date">`).
 */
export type ControlValue = number | boolean | string | DateValue;

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
  /** Set a value control (slider, switch, picker, segmented control, date picker) to `value`. */
  | { type: 'setValue'; matcher: Matcher; value: ControlValue }
  /** Move a slider's thumb to `position` (0 = minimum, 1 = maximum) — Detox adjustSliderToPosition. */
  | { type: 'adjustSlider'; matcher: Matcher; position: number }
  /** Perform a declared accessibility action (`accessibilityActions`) — Detox performAccessibilityAction. */
  | { type: 'accessibilityAction'; matcher: Matcher; name: string }
  /** Two fingers change their distance by `scale` (> 1 apart, < 1 together) on a line at `angle` radians (0 = horizontal). */
  | { type: 'pinch'; matcher: Matcher; scale: number; angle?: number; speed?: Speed }
  /** Two fingers turn `radians` (positive: clockwise on screen) around the element's center. */
  | { type: 'rotate'; matcher: Matcher; radians: number; speed?: Speed }
  /**
   * Fingers along timed paths (each finger is down from its first to its last point). Window
   * coordinates, or the element's own coordinates when `matcher` is given.
   */
  | { type: 'multiTouch'; matcher?: Matcher; fingers: TimedPoint[][] }
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
  /**
   * Several fingers (touch screens): flat frames `[tMs, down0, x0, y0, down1, x1, y1, ...]` for
   * `fingers` fingers, played back as touch events (web: CDP Input.dispatchTouchEvent).
   */
  | { kind: 'touches'; fingers: number; frames: number[] }
  /** Choose the option with this value in the `<select>` at (x, y) (Playwright selectOption). */
  | { kind: 'select'; x: number; y: number; value: string }
  /** Set the value of the `<input>` at (x, y) as a user would (Playwright fill: date / time inputs). */
  | { kind: 'fill'; x: number; y: number; value: string }
  | { kind: 'navigate'; url: string }
  | { kind: 'back' };
