/**
 * Platform modules for web (react-dom + react-native-web). Metro uses default-deps.native.ts on iOS / Android.
 */
import type { PlatformDeps } from './host';

declare const require: (id: string) => unknown;

interface WindowLike {
  innerWidth: number;
  innerHeight: number;
  getComputedStyle(el: Element): CSSStyleDeclaration;
}

function win(): WindowLike | null {
  const w = (globalThis as { window?: WindowLike }).window;
  return w !== undefined && typeof w.getComputedStyle === 'function' ? w : null;
}

export const defaultPlatformDeps: PlatformDeps = {
  viewport() {
    const w = win();
    return w === null ? null : { width: w.innerWidth, height: w.innerHeight };
  },
  focusedElement() {
    const doc = (globalThis as { document?: { activeElement?: unknown } }).document;
    return doc?.activeElement ?? null;
  },
  getComputedStyle(el) {
    const w = win();
    if (w === null || typeof Element === 'undefined' || !(el instanceof Element)) return null;
    const s = w.getComputedStyle(el);
    return { display: s.display, opacity: s.opacity, overflowX: s.overflowX, overflowY: s.overflowY };
  },
};

export function loadScheduler(): unknown {
  return require('scheduler');
}
