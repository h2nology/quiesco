/**
 * Renderer-specific details. These are the only three differences between Fabric and
 * react-dom + react-native-web that the query layer needs (docs/spikes/07-web-fiber-query.md),
 * plus style-based hiding and the viewport size.
 */
import type { Rect } from '@quiesco/protocol';

import type { Fiber } from './fiber';
import { isObject } from './fiber';
import type { RendererKind, Viewport } from './types';

export interface HostPlatform {
  kind: RendererKind;
  testID(props: Record<string, unknown>): string | undefined;
  label(props: Record<string, unknown>): string | undefined;
  role(props: Record<string, unknown>): string | undefined;
  hiddenByStyle(fiber: Fiber, props: Record<string, unknown>): boolean;
  measure(fiber: Fiber): Rect | null;
  /** React view tag of the native view (Fabric), for native touch injection. Null on web. */
  nativeTag(fiber: Fiber): number | null;
  viewport(): Viewport | null;
}

/** Lazily loaded platform modules. Injected so the adapter can be unit-tested without React Native. */
export interface PlatformDeps {
  /**
   * Fabric's `getPublicInstanceFromInternalInstanceHandle`, from
   * `react-native/Libraries/Renderer/shims/ReactFabric` (private path; docs/spikes/01 §3).
   */
  getPublicInstance?: () => ((fiber: Fiber) => unknown) | null;
  /** `Dimensions.get('window')` on native; `{ innerWidth, innerHeight }` on web. */
  viewport?: () => Viewport | null;
  /** `window.getComputedStyle` on web. */
  getComputedStyle?: (el: unknown) => { display?: string; opacity?: string } | null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function toRect(r: unknown): Rect | null {
  if (!isObject(r)) return null;
  const { x, y, width, height } = r;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') return null;
  return { x, y, width, height };
}

function callRect(el: unknown): Rect | null {
  if (!isObject(el) || typeof el['getBoundingClientRect'] !== 'function') return null;
  try {
    return toRect((el['getBoundingClientRect'] as () => unknown).call(el));
  } catch {
    return null;
  }
}

/** Flatten an RN style prop (object, nested arrays, falsy entries). Registered numeric styles are ignored. */
export function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    const out: Record<string, unknown> = {};
    for (const s of style) Object.assign(out, flattenStyle(s));
    return out;
  }
  return isObject(style) ? { ...style } : {};
}

function hiddenStyle(display: unknown, opacity: unknown): boolean {
  return display === 'none' || opacity === 0 || opacity === '0';
}

export function nativePlatform(deps: PlatformDeps): HostPlatform {
  let getPublic: ((fiber: Fiber) => unknown) | null | undefined;
  return {
    kind: 'native',
    testID: (p) => str(p['testID']),
    label: (p) => str(p['accessibilityLabel']) ?? str(p['aria-label']),
    role: (p) => str(p['accessibilityRole']) ?? str(p['role']),
    hiddenByStyle: (_fiber, p) => {
      const s = flattenStyle(p['style']);
      return hiddenStyle(s['display'], s['opacity']);
    },
    measure(fiber) {
      return callRect(publicInstance(fiber));
    },
    nativeTag(fiber) {
      const el = publicInstance(fiber);
      const tag = isObject(el) ? el['__nativeTag'] : undefined;
      return typeof tag === 'number' ? tag : null;
    },
    viewport: () => deps.viewport?.() ?? null,
  };

  function publicInstance(fiber: Fiber): unknown {
    if (getPublic === undefined) {
      try {
        getPublic = deps.getPublicInstance?.() ?? null;
      } catch {
        getPublic = null;
      }
    }
    if (getPublic === null) return null;
    try {
      return getPublic(fiber);
    } catch {
      return null;
    }
  }
}

export function webPlatform(deps: PlatformDeps): HostPlatform {
  return {
    kind: 'web',
    // react-native-web forwards testID to the DOM element as data-testid; testID itself stays on the RNW composite.
    testID: (p) => str(p['data-testid']) ?? str(p['testID']),
    label: (p) => str(p['aria-label']) ?? str(p['accessibilityLabel']),
    role: (p) => str(p['role']) ?? str(p['accessibilityRole']),
    hiddenByStyle(fiber, p) {
      // RNW compiles StyleSheet styles to class names, so the computed style is the reliable source.
      const computed = deps.getComputedStyle?.(fiber.stateNode) ?? null;
      if (computed !== null) return hiddenStyle(computed.display, computed.opacity);
      const s = flattenStyle(p['style']);
      return hiddenStyle(s['display'], s['opacity']);
    },
    measure: (fiber) => callRect(fiber.stateNode),
    nativeTag: () => null,
    viewport: () => deps.viewport?.() ?? null,
  };
}
