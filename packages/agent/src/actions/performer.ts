/**
 * How actions reach the app. `js` calls component callbacks (actions/js.ts); `native` injects real
 * touches and IME text through @quiesco/native (actions/native.ts). The runtime resolves the target
 * element and syncs; the performer only performs.
 */
import type { Direction, Speed } from '@quiesco/protocol';

import type { HostNode } from '../fiber-adapter';
import * as js from './js';

export interface ActionPerformer {
  tap(node: HostNode): Promise<void>;
  longPress(node: HostNode, durationMs?: number): Promise<void>;
  doubleTap(node: HostNode): Promise<void>;
  type(node: HostNode, text: string): Promise<void>;
  clear(node: HostNode): Promise<void>;
  /** `down` reveals content further down. */
  scroll(node: HostNode, direction: Direction, distance?: number): Promise<void>;
  /** Finger direction: `up` moves the finger up. */
  swipe(node: HostNode, direction: Direction, speed?: Speed): Promise<void>;
}

export function jsPerformer(ctx: js.JsActionContext): ActionPerformer {
  return {
    tap: async (n) => js.tap(n, ctx),
    longPress: async (n) => js.longPress(n, ctx),
    doubleTap: async (n) => js.doubleTap(n, ctx),
    type: async (n, text) => js.typeText(n, text, ctx),
    clear: async (n) => js.clearText(n, ctx),
    scroll: async (n, direction, distance) => js.scrollBy(js.requireScrollable(n, 'scroll', ctx), direction, distance),
    swipe: async (n, direction) => js.scrollBy(js.requireScrollable(n, 'swipe', ctx), js.swipeToScrollDirection(direction)),
  };
}
