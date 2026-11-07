import type { Matcher } from './matcher.js';

export type ActionMode = 'native' | 'js';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Speed = 'slow' | 'normal' | 'fast';

/** Actions from requirements.md §6.3. */
export type ActionSpec =
  | { type: 'tap'; matcher: Matcher }
  | { type: 'longPress'; matcher: Matcher; durationMs?: number }
  | { type: 'doubleTap'; matcher: Matcher }
  | { type: 'type'; matcher: Matcher; text: string }
  | { type: 'clear'; matcher: Matcher }
  | { type: 'scroll'; matcher: Matcher; direction: Direction; distance?: number }
  | { type: 'scrollTo'; container: Matcher; target: Matcher }
  | { type: 'swipe'; matcher: Matcher; direction: Direction; speed?: Speed }
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
  | { kind: 'drag'; from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }
  | { kind: 'key'; key: string }
  | { kind: 'navigate'; url: string }
  | { kind: 'back' };
