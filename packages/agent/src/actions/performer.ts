/**
 * How actions reach the app. `js` calls component callbacks (actions/js.ts); `native` injects real
 * touches and IME text through @quiesco/native (actions/native.ts). The runtime resolves the target
 * element and syncs; the performer only performs.
 */
import type { ControlValue, Direction, HostInput, KeyName, Point, Speed } from '@quiesco/protocol';

import type { HostNode } from '../fiber-adapter';
import * as js from './js';
import type { A11yTarget, Control } from './value';
import * as value from './value';

/**
 * Each method performs the action, or returns the HostInput the host must inject (`host` performer:
 * real browser input through Playwright). The runtime then hands it to the host and does not sync.
 */
export type Performed = Promise<HostInput | void>;

export interface ActionPerformer {
  /** Whether results are HostInputs (the host injects; multi-step actions cannot loop in the agent). */
  readonly viaHost: boolean;
  /** `point`: inside the element, in its own coordinates (default: center). */
  tap(node: HostNode, point?: Point): Performed;
  longPress(node: HostNode, durationMs?: number, point?: Point): Performed;
  multiTap(node: HostNode, count: number): Performed;
  type(node: HostNode, text: string): Performed;
  replaceText(node: HostNode, text: string): Performed;
  clear(node: HostNode): Performed;
  pressKey(node: HostNode, key: KeyName): Performed;
  /** `down` reveals content further down. `from`: start inside the element, normalized 0–1. */
  scroll(node: HostNode, direction: Direction, distance?: number, from?: Point): Performed;
  /** Finger direction: `up` moves the finger up. */
  swipe(node: HostNode, direction: Direction, speed?: Speed, distance?: number, from?: Point): Performed;
  /** Press the element's center, hold `holdMs`, move to the window point `to` over `durationMs`, release. */
  drag(node: HostNode, to: Point, holdMs: number, durationMs: number): Performed;
  /** A touch at a window point, not tied to an element (Detox `device.tap`). */
  tapAt(point: Point, holdMs?: number): Performed;
  /** Set a value control (actions/value.ts) to `value`. */
  setValue(control: Control, value: ControlValue): Performed;
  /** Move the slider `control` (on `node`) to `position` (0 … 1). */
  adjustSlider(node: HostNode, control: Control, position: number): Performed;
  /** Perform a declared accessibility action. */
  accessibilityAction(target: A11yTarget, name: string): Performed;
}

export function jsPerformer(ctx: js.JsActionContext): ActionPerformer {
  return {
    viaHost: false,
    tap: async (n, point) => js.tap(n, ctx, point),
    longPress: async (n, _durationMs, point) => js.longPress(n, ctx, point),
    multiTap: async (n, count) => js.multiTap(n, count, ctx),
    type: async (n, text) => js.typeText(n, text, ctx),
    replaceText: async (n, text) => js.replaceText(n, text, ctx),
    clear: async (n) => js.clearText(n, ctx),
    pressKey: async (n, key) => js.pressKey(n, key, ctx),
    scroll: async (n, direction, distance) => js.scrollBy(js.requireScrollable(n, 'scroll', ctx), direction, distance),
    swipe: async (n, direction, _speed, distance) => js.scrollBy(js.requireScrollable(n, 'swipe', ctx), js.swipeToScrollDirection(direction), distance),
    drag: async () => {
      throw js.notSupported('drag', ctx, 'dragging needs real touches (gesture recognizers, PanResponder); use native mode');
    },
    tapAt: async (point, holdMs) => js.tapAt(point, holdMs !== undefined && holdMs >= js.LONG_PRESS_THRESHOLD_MS, ctx),
    setValue: async (control, v) => value.jsSetValue(control, v, ctx.platform),
    adjustSlider: async (_node, control, position) => value.jsSetValue(control, value.sliderValueAt(value.sliderRange(control.props), position), ctx.platform),
    accessibilityAction: async (target, name) => value.jsAccessibilityAction(target, name, ctx.platform),
  };
}
