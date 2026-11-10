/**
 * Public React Native APIs the agent needs at runtime, loaded lazily (never at agent import time:
 * that would load React Native before the DevTools hook is installed). Injected for unit tests.
 * On web, `react-native` is aliased to react-native-web, which provides the same APIs.
 */
import type { AppStateName, Platform, Rect } from '@quiesco/protocol';

import type { NativeBridge } from './actions/native';
import type { InteractionManagerLike } from './sync';

declare const require: (id: string) => unknown;

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface AppDeps {
  platform(): Platform;
  dismissKeyboard(): void;
  /** The software keyboard's frame in screen coordinates while it is shown, else null. */
  keyboardFrame(): Rect | null;
  /** @quiesco/native when it is installed and its native code is linked, else null. */
  nativeModule(): NativeModuleLike | null;
  createSocket(url: string): SocketLike;
  /** Legacy InteractionManager (RN < 0.88), or null. */
  interactionManager(): InteractionManagerLike | null;
  /** React Native's AppState (react-native-web: from the page visibility). */
  appState(): AppStateName;
  /**
   * Calls `listener` on every AppState change; returns the unsubscribe. Events still arrive while Android
   * pauses the JS timers (another activity on top, e.g. a permission dialog).
   */
  onAppStateChange?(listener: () => void): () => void;
  /** The window in logical units and physical pixels per unit. */
  windowInfo(): { width: number; height: number; pixelRatio: number };
  /** What the app sees of the device settings (Phase 6.6 read-backs). */
  settings(): { colorScheme: 'light' | 'dark' | null; fontScale: number; locale: string };
}

/** What the agent uses of @quiesco/native besides the action bridge. */
export type NativeModuleLike = NativeBridge & {
  /** `args`: base64 of the launch arguments' JSON (Phase 6.5); missing in older native builds. */
  getLaunchParams(): { port: string | null; session: string | null; args?: string | null };
  /** iOS: leave for the home screen. Missing on Android and in older native builds. */
  suspend?(): Promise<boolean>;
  /** iOS: rotate the window scene; resolves with an error message, or '' when requested (Phase 6.6). */
  setOrientation?(landscape: boolean): Promise<string>;
  /** Android: post a notification as the app (Phase 6.7). */
  postNotification?(title: string, body: string, data: Record<string, string>): Promise<{ enabled: boolean }>;
  /** The clipboard's text ('' when it holds none), read inside the app (Phase 6.6). */
  getClipboard?(): Promise<string>;
  setClipboard?(text: string): Promise<void>;
  /** The WebView inside a view (Phase 6.8): its rect in the window and load state. */
  webviewInfo?(tag: number): Promise<{ found: boolean; x?: number; y?: number; width?: number; height?: number; insetTop?: number; insetLeft?: number; loading?: boolean }>;
  /** Evaluate a string-valued expression in the WebView's main frame. */
  webviewEval?(tag: number, script: string): Promise<string>;
  /** Run `source` at document start of the WebView's later loads; false where the WebView cannot. */
  webviewAddStartScript?(tag: number, source: string): Promise<boolean>;
};

interface RN {
  Platform: { OS: string };
  Keyboard: {
    dismiss(): void;
    // React Native ≥ 0.70; react-native-web has neither (no software keyboard to track).
    isVisible?(): boolean;
    metrics?(): { screenX: number; screenY: number; width: number; height: number } | null | undefined;
  };
  InteractionManager?: InteractionManagerLike;
  AppState: { currentState: string | null | undefined; addEventListener(type: 'change', listener: () => void): { remove(): void } };
  Dimensions: { get(dim: 'window'): { width: number; height: number } };
  PixelRatio: { get(): number; getFontScale(): number };
  Appearance: { getColorScheme(): string | null | undefined };
}

const rn = (): RN => require('react-native') as RN;

type MatchMedia = (query: string) => { matches: boolean };

/**
 * The color scheme the app sees, read without disturbing it. Where `matchMedia` exists (the web), a
 * fresh MediaQueryList is asked: reading `matches` on react-native-web's own list (Appearance) updates
 * its remembered state, and Chromium then dispatches no change event to the app's listeners
 * (useColorScheme never updates; found in Phase 6.6). Native: React Native's Appearance.
 */
export function readColorScheme(matchMedia: MatchMedia | undefined, appearance: () => string | null | undefined): 'light' | 'dark' | null {
  if (typeof matchMedia === 'function') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const s = appearance();
  return s === 'light' || s === 'dark' ? s : null;
}

export const defaultAppDeps: AppDeps = {
  platform() {
    const os = rn().Platform.OS;
    return os === 'ios' || os === 'android' ? os : 'web';
  },
  dismissKeyboard() {
    rn().Keyboard.dismiss();
  },
  keyboardFrame() {
    const k = rn().Keyboard;
    if (k.isVisible?.() !== true) return null;
    const m = k.metrics?.();
    return m === null || m === undefined ? null : { x: m.screenX, y: m.screenY, width: m.width, height: m.height };
  },
  nativeModule() {
    // Optional dependency: Metro bundles apps without @quiesco/native when the require sits directly
    // in a try block (transformer.allowOptionalDependencies, on by default).
    try {
      const mod = require('@quiesco/native') as { QuiescoNative?: ReturnType<AppDeps['nativeModule']> };
      return mod.QuiescoNative ?? null;
    } catch {
      return null;
    }
  },
  createSocket(url) {
    const WS = (globalThis as unknown as { WebSocket: new (url: string) => SocketLike }).WebSocket;
    return new WS(url);
  },
  appState() {
    const s = rn().AppState.currentState;
    return s === 'active' || s === 'background' || s === 'inactive' ? s : 'unknown';
  },
  onAppStateChange(listener) {
    const sub = rn().AppState.addEventListener('change', listener);
    return () => sub.remove();
  },
  windowInfo() {
    const { width, height } = rn().Dimensions.get('window');
    return { width, height, pixelRatio: rn().PixelRatio.get() };
  },
  settings() {
    const mm = (globalThis as { matchMedia?: MatchMedia }).matchMedia;
    return {
      colorScheme: readColorScheme(mm?.bind(globalThis), () => rn().Appearance.getColorScheme()),
      fontScale: rn().PixelRatio.getFontScale(),
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
    };
  },
  interactionManager() {
    try {
      // RN 0.88 replaced it with a getter that throws in __DEV__ (removed from core).
      return rn().InteractionManager ?? null;
    } catch {
      return null;
    }
  },
};
