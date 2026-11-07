/* eslint-disable @typescript-eslint/no-explicit-any */
export type Rect = { x: number; y: number; width: number; height: number };

// react-dom: host fiber stateNode is the DOM element.
export function measureFiber(fiber: any): { rect?: Rect; window?: Rect; windowSync: boolean; error?: string } {
  try {
    const r = (fiber.stateNode as HTMLElement).getBoundingClientRect();
    const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
    return { rect, window: rect, windowSync: true };
  } catch (e) {
    return { windowSync: false, error: String(e) };
  }
}
