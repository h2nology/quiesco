import type { ActionMode, Point, Speed } from '@quiesco/protocol';

import type { MatcherInput } from './matcher.js';

/** Options every Driver call accepts. */
export interface CallOptions {
  /** Per-call timeout (agent side). Default: `sync.timeoutMs`. */
  timeoutMs?: number;
  /** `false` skips waiting for idle around this call (infinite animations etc.). */
  sync?: boolean;
}

export interface ActionOptions extends CallOptions {
  mode?: ActionMode;
}

/** `type()` options (issue #52). */
export interface TypeOptions extends ActionOptions {
  /**
   * Type one character at a time, as a user does, so the app sees every keystroke (debounced search,
   * input masks, `onKeyPress`). Default: the whole text at once.
   */
  perCharacter?: boolean;
  /** With `perCharacter`: time between two characters (default 80 ms). The call waits for idle at the end. */
  intervalMs?: number;
}

/** `tap()` options. */
export interface TapOptions extends ActionOptions {
  /** Where to touch, in the element's own coordinates (default: its center). */
  point?: Point;
}

/** `longPress()` options. */
export interface LongPressOptions extends ActionOptions {
  /** How long to hold (default 800 ms). */
  durationMs?: number;
  /** Where to touch, in the element's own coordinates (default: its center). */
  point?: Point;
}

/** `longPressAt()` options. */
export interface LongPressAtOptions extends ActionOptions {
  /** How long to hold (default 800 ms). */
  durationMs?: number;
}

/** `scroll()` options. */
export interface ScrollOptions extends ActionOptions {
  /** How far to scroll, in logical units. */
  distance?: number;
  /** Where the finger starts inside the element, normalized 0–1 (default: around the center). */
  from?: Point;
}

/** `scrollToIndex()` options. */
export interface ScrollToIndexOptions extends ActionOptions {
  /** Where the item lands in the list: 0 top, 0.5 middle, 1 bottom (FlatList's `viewPosition`). */
  viewPosition?: number;
}

/** `swipe()` options. */
export interface SwipeOptions extends ActionOptions {
  speed?: Speed;
  /** How far to swipe, in logical units. */
  distance?: number;
  /** Where the finger starts inside the element, normalized 0–1 (default: around the center). */
  from?: Point;
}

/** `drag()` options. */
export interface DragOptions extends ActionOptions {
  /** How long to hold before moving (default 800 ms: enough for a long-press drag). */
  holdMs?: number;
  speed?: Speed;
}

/** `pinch()` options. */
export interface PinchOptions extends ActionOptions {
  /** The fingers' axis in radians (default 0: horizontal). */
  angle?: number;
  speed?: Speed;
}

/** `rotate()` options. */
export interface RotateOptions extends ActionOptions {
  speed?: Speed;
}

/** `multiTouch()` options. */
export interface MultiTouchOptions extends ActionOptions {
  /** The points are in this element's own coordinates (it must be visible) instead of the window's. */
  within?: MatcherInput;
}

/** `waitForIdle()` options. */
export interface WaitForIdleOptions {
  /** How long to wait. Default: `sync.timeoutMs`. */
  timeoutMs?: number;
}
