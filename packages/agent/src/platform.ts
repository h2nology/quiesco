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
  /** The window in logical units and physical pixels per unit. */
  windowInfo(): { width: number; height: number; pixelRatio: number };
}

/** What the agent uses of @quiesco/native besides the action bridge. */
export type NativeModuleLike = NativeBridge & {
  /** `args`: base64 of the launch arguments' JSON (Phase 6.5); missing in older native builds. */
  getLaunchParams(): { port: string | null; session: string | null; args?: string | null };
  /** iOS: leave for the home screen. Missing on Android and in older native builds. */
  suspend?(): Promise<boolean>;
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
  AppState: { currentState: string | null | undefined };
  Dimensions: { get(dim: 'window'): { width: number; height: number } };
  PixelRatio: { get(): number };
}

const rn = (): RN => require('react-native') as RN;

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
  windowInfo() {
    const { width, height } = rn().Dimensions.get('window');
    return { width, height, pixelRatio: rn().PixelRatio.get() };
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
