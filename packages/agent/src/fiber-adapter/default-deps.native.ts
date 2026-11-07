/**
 * Platform modules for iOS / Android (Metro picks this file over default-deps.ts for native platforms).
 * Everything is loaded lazily: requiring the renderer shim at agent install time would load the
 * renderer BEFORE the DevTools hook and scheduler patch are in place.
 */
import type { PlatformDeps } from './host';
import type { Fiber } from './fiber';
import type { Viewport } from './types';

declare const require: (id: string) => unknown;

interface FabricShim {
  getPublicInstanceFromInternalInstanceHandle?: (fiber: Fiber) => unknown;
}

export const defaultPlatformDeps: PlatformDeps = {
  getPublicInstance() {
    // Private RN path (docs/spikes/01 §3). RN 0.88 warns about deep imports; isolated here on purpose.
    const mod = require('react-native/Libraries/Renderer/shims/ReactFabric') as { default?: FabricShim } & FabricShim;
    const shim = mod.default ?? mod;
    return shim.getPublicInstanceFromInternalInstanceHandle ?? null;
  },
  viewport() {
    const rn = require('react-native') as { Dimensions: { get(dim: 'window'): Viewport } };
    const { width, height } = rn.Dimensions.get('window');
    return { width, height };
  },
};

export function loadScheduler(): unknown {
  return require('scheduler');
}
