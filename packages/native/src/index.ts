/**
 * JS face of the QuiescoNative Expo Module. `null` when the native code is not linked (JS-only builds,
 * production builds where the config plugin excluded it, or platforms without an implementation).
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface LocateResult {
  found: boolean;
  /** dp, in the coordinate space of the view's window. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  shown?: boolean;
  /** False when another window of the app (e.g. a Modal dialog) holds the input focus. */
  windowHasFocus?: boolean;
  windowIndex?: number;
  windowCount?: number;
  windowClass?: string;
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
  /** `tag < 0`: tap the point (x, y) in dp of the activity window. */
  tap(tag: number, x: number, y: number, holdMs: number, count: number): Promise<TapResult>;
  swipe(tag: number, fromX: number, fromY: number, toX: number, toY: number, durationMs: number): Promise<{ handled: boolean }>;
  typeText(tag: number, text: string, replace: boolean): Promise<{ text: string; inputConnection: boolean; focused: boolean }>;
}

export const QuiescoNative: QuiescoNativeModule | null = requireOptionalNativeModule<QuiescoNativeModule>('QuiescoNative');

export default QuiescoNative;
