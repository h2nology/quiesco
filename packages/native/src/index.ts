/**
 * JS face of the QuiescoNative Expo Module (Android: ./android, iOS: ./ios). `null` when the native code
 * is not linked (JS-only builds, production builds where the config plugin excluded it, web).
 *
 * Coordinates are in the window of the addressed view: dp on Android, pt on iOS — the space of
 * `getBoundingClientRect()` on both. Rejections carry one of {@link NativeErrorCode}.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

/** `code` of a rejected call. */
export type NativeErrorCode =
  /** iOS: the private UIKit API used for touch injection is missing on this iOS version. */
  | 'E_UNSUPPORTED'
  /** The view (or its window) is gone, e.g. unmounted. */
  | 'E_NO_VIEW'
  /** typeText on a view that contains no text field. */
  | 'E_NOT_TEXT_INPUT'
  /** openUrl with an unparsable URL. */
  | 'E_BAD_URL'
  /** gesture / pressKey with malformed arguments. */
  | 'E_BAD_ARGS';

export interface LocateResult {
  found: boolean;
  /** In the coordinate space of the view's window (dp on Android, pt on iOS). */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  shown?: boolean;
  /**
   * False when a touch at the center would not reach the view. Android: another window of the app
   * (e.g. a Modal dialog) holds the input focus. iOS (Modals share the window): the topmost view at the
   * center, across all windows, is not the view or one of its descendants.
   */
  windowHasFocus?: boolean;
  windowIndex?: number;
  windowCount?: number;
  windowClass?: string;
  /**
   * iOS: touches may be dropped or land elsewhere right now — a view controller transition, a Core
   * Animation on the view or an ancestor, or the software keyboard sliding in / out.
   */
  settling?: boolean;
  /** iOS: class of the native view a touch at the center would reach, its superview chain and their tags. */
  hitClass?: string;
  hitChain?: string[];
  hitTags?: number[];
}

export interface TapResult {
  x: number;
  y: number;
  handled: boolean;
  windowHasFocus: boolean;
}

export interface QuiescoNativeModule {
  getLaunchParams(): { port: string | null; session: string | null };
  locate(tag: number): Promise<LocateResult>;
  /** iOS: who would receive a touch at the window point (x, y) of `tag`'s window. */
  hitAt?(tag: number, x: number, y: number): Promise<Pick<LocateResult, 'windowHasFocus' | 'hitClass' | 'hitChain' | 'hitTags'>>;
  /** `tag < 0`: tap the point (x, y) of the main window (Android: activity window; iOS: key window). */
  tap(tag: number, x: number, y: number, holdMs: number, count: number): Promise<TapResult>;
  swipe(tag: number, fromX: number, fromY: number, toX: number, toY: number, durationMs: number): Promise<{ handled: boolean }>;
  typeText(tag: number, text: string, replace: boolean): Promise<{ text: string; inputConnection: boolean; focused: boolean }>;
  /**
   * One finger along a timed path in the window of `tag` (main window when tag < 0): flat
   * `[x, y, tMs, x, y, tMs, ...]`, t from 0 and increasing; down at the first point, up at the last.
   * Equal consecutive points are a hold.
   */
  gesture?(tag: number, path: number[]): Promise<{ handled: boolean }>;
  /** `enter` (return / IME action) or `backspace` on the text field `tag`, the way the software keyboard sends them. */
  pressKey?(tag: number, key: 'enter' | 'backspace'): Promise<{ text: string; focused: boolean }>;
  /**
   * iOS only: open a URL from inside the app (own scheme: routed to RN Linking without the system
   * confirmation alert of `simctl openurl`). Android opens deep links from the host (`am start`).
   */
  openUrl?(url: string): Promise<{ opened: boolean }>;
  /**
   * iOS only, synchronous: native UI still settling (view controller transition, keyboard moving or
   * just used), sampled every frame. Used by the agent's `native` idle tracker.
   */
  idleState?(): { settling: boolean; reasons: string[] };
}

export const QuiescoNative: QuiescoNativeModule | null = requireOptionalNativeModule<QuiescoNativeModule>('QuiescoNative');

export default QuiescoNative;
