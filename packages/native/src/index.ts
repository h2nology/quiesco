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
  | 'E_BAD_URL';

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
  /** iOS: a view controller transition or a Core Animation is running on the view or an ancestor. */
  settling?: boolean;
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
  /** `tag < 0`: tap the point (x, y) of the main window (Android: activity window; iOS: key window). */
  tap(tag: number, x: number, y: number, holdMs: number, count: number): Promise<TapResult>;
  swipe(tag: number, fromX: number, fromY: number, toX: number, toY: number, durationMs: number): Promise<{ handled: boolean }>;
  typeText(tag: number, text: string, replace: boolean): Promise<{ text: string; inputConnection: boolean; focused: boolean }>;
  /**
   * iOS only: open a URL from inside the app (own scheme: routed to RN Linking without the system
   * confirmation alert of `simctl openurl`). Android opens deep links from the host (`am start`).
   */
  openUrl?(url: string): Promise<{ opened: boolean }>;
}

export const QuiescoNative: QuiescoNativeModule | null = requireOptionalNativeModule<QuiescoNativeModule>('QuiescoNative');

export default QuiescoNative;
