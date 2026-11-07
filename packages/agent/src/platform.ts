/**
 * Public React Native APIs the agent needs at runtime, loaded lazily (never at agent import time:
 * that would load React Native before the DevTools hook is installed). Injected for unit tests.
 * On web, `react-native` is aliased to react-native-web, which provides the same APIs.
 */
import type { Platform } from '@quiesco/protocol';

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
  /** @quiesco/native when it is installed and its native code is linked, else null. */
  nativeModule(): (NativeBridge & { getLaunchParams(): { port: string | null; session: string | null } }) | null;
  createSocket(url: string): SocketLike;
  /** Legacy InteractionManager (RN < 0.88), or null. */
  interactionManager(): InteractionManagerLike | null;
}

interface RN {
  Platform: { OS: string };
  Keyboard: { dismiss(): void };
  InteractionManager?: InteractionManagerLike;
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
  interactionManager() {
    try {
      // RN 0.88 replaced it with a getter that throws in __DEV__ (removed from core).
      return rn().InteractionManager ?? null;
    } catch {
      return null;
    }
  },
};
