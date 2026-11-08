/**
 * How actions reach the app. `js` calls component callbacks (actions/js.ts); `native` injects real
 * touches and IME text through @quiesco/native (actions/native.ts). The runtime resolves the target
 * element and syncs; the performer only performs.
 */
import type { Direction, HostInput, Speed } from '@quiesco/protocol';

import type { HostNode } from '../fiber-adapter';
import * as js from './js';

/**
 * Each method performs the action, or returns the HostInput the host must inject (`host` performer:
 * real browser input through Playwright). The runtime then hands it to the host and does not sync.
 */
export type Performed = Promise<HostInput | void>;

export interface ActionPerformer {
  /** Whether results are HostInputs (the host injects; multi-step actions cannot loop in the agent). */
  readonly viaHost: boolean;
  tap(node: HostNode): Performed;
  longPress(node: HostNode, durationMs?: number): Performed;
  doubleTap(node: HostNode): Performed;
  type(node: HostNode, text: string): Performed;
  clear(node: HostNode): Performed;
  /** `down` reveals content further down. */
  scroll(node: HostNode, direction: Direction, distance?: number): Performed;
  /** Finger direction: `up` moves the finger up. */
  swipe(node: HostNode, direction: Direction, speed?: Speed): Performed;
}

export function jsPerformer(ctx: js.JsActionContext): ActionPerformer {
  return {
    viaHost: false,
    tap: async (n) => js.tap(n, ctx),
    longPress: async (n) => js.longPress(n, ctx),
    doubleTap: async (n) => js.doubleTap(n, ctx),
    type: async (n, text) => js.typeText(n, text, ctx),
    clear: async (n) => js.clearText(n, ctx),
    scroll: async (n, direction, distance) => js.scrollBy(js.requireScrollable(n, 'scroll', ctx), direction, distance),
    swipe: async (n, direction) => js.scrollBy(js.requireScrollable(n, 'swipe', ctx), js.swipeToScrollDirection(direction)),
  };
}
