/* eslint-disable @typescript-eslint/no-explicit-any */
// Fabric: fiber -> public instance (ReactNativeElement, DOM-like API).
// No TS types are published for the renderer shim; it is a private RN path (fiber-adapter only).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactFabric = require('react-native/Libraries/Renderer/shims/ReactFabric').default;
const getPublicInstanceFromInternalInstanceHandle = ReactFabric.getPublicInstanceFromInternalInstanceHandle;

export type Rect = { x: number; y: number; width: number; height: number };

export function measureFiber(fiber: any): { rect?: Rect; window?: Rect; windowSync: boolean; error?: string } {
  try {
    const el: any = (getPublicInstanceFromInternalInstanceHandle as any)(fiber);
    const r = el.getBoundingClientRect();
    let win: Rect | undefined;
    el.measureInWindow((x: number, y: number, width: number, height: number) => {
      win = { x, y, width, height };
    });
    return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, window: win, windowSync: win !== undefined };
  } catch (e) {
    return { windowSync: false, error: String(e) };
  }
}
