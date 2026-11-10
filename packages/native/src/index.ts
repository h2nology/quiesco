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
  | 'E_BAD_ARGS'
  /** accessibilityAction: the view does not offer the action. */
  | 'E_NO_ACTION';

/** Slider geometry in the window of the view (see sliderInfo). */
export interface SliderInfo {
  found: boolean;
  /** x of the thumb center at the minimum / maximum value. */
  minX?: number;
  maxX?: number;
  /** Current thumb center. */
  thumbX?: number;
  y?: number;
  value?: number;
  minimum?: number;
  maximum?: number;
}

/** One column of a wheel picker (see wheelInfo). */
export interface WheelComponent {
  selectedRow: number;
  rows: number;
  rowHeight: number;
  /** Title of the selected row, when it can be read. */
  title: string | null;
  /** The column's rect in the window, when its view was found. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface WheelInfo {
  found: boolean;
  components?: WheelComponent[];
  columnCount?: number;
  /** A wheel is still tracking a finger, dragging or decelerating (values update once it stops). */
  moving?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** UIDatePicker: its date (ms since epoch), mode (0 time, 1 date, 2 date and time) and locale. */
  date?: number;
  datePickerMode?: number;
  locale?: string;
  /** Diagnostics: the picker's view hierarchy. */
  tree?: string[];
}

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
  /** `args`: base64 of the test's launch arguments as JSON (Phase 6.5). */
  getLaunchParams(): { port: string | null; session: string | null; args: string | null };
  /** iOS only: leave for the home screen (private `-[UIApplication suspend]`); false when unavailable. */
  suspend?(): Promise<boolean>;
  /** iOS only: rotate the window scene; resolves with "" or iOS's error message (Phase 6.6). */
  setOrientation?(landscape: boolean): Promise<string>;
  /**
   * Android only: post a notification as the app (tapping it opens the app with `data` as intent extras);
   * resolves with whether the app may show notifications (Phase 6.7).
   */
  postNotification?(title: string, body: string, data: Record<string, string>): Promise<{ enabled: boolean }>;
  /** The clipboard's text ('' when none), read in the app's process (Phase 6.6; absent in older builds). */
  getClipboard?(): Promise<string>;
  /** Put plain text on the clipboard from the app's process (Phase 6.6). */
  setClipboard?(text: string): Promise<void>;
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
  /**
   * Several fingers along timed paths in the window of `tag` (main window when tag < 0): `frames` is flat,
   * per frame `[tMs, down0, x0, y0, down1, x1, y1, ...]` for `fingerCount` fingers (down 1 / 0). Absent in
   * apps built before Phase 6.4.
   */
  multiGesture?(tag: number, fingerCount: number, frames: number[]): Promise<{ handled: boolean }>;
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
  /** Slider geometry (iOS UISlider, Android SeekBar) inside `tag`'s view. Absent in apps built before Phase 6.3. */
  sliderInfo?(tag: number): Promise<SliderInfo>;
  /** iOS only: the wheel picker (UIPickerView / UIDatePicker wheels) inside `tag`'s view. Absent before Phase 6.3. */
  wheelInfo?(tag: number): Promise<WheelInfo>;
  /**
   * Perform the declared accessibility action `name` as the screen reader does. `label`: its label (or
   * the name); `index`: its position in accessibilityActions (iOS custom actions); `customIndex`: its
   * position among the non-standard actions (Android generated ids). Absent before Phase 6.3.
   */
  accessibilityAction?(tag: number, name: string, label: string, index: number, customIndex: number): Promise<{ performed: boolean; via: string }>;
}

export const QuiescoNative: QuiescoNativeModule | null = requireOptionalNativeModule<QuiescoNativeModule>('QuiescoNative');

export default QuiescoNative;
