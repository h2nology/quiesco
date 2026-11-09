/**
 * `native` action mode without @quiesco/native: the host injects real input (web: Playwright mouse,
 * touchscreen, keyboard, wheel). The agent picks the point and runs the same checks as the in-app
 * native mode (stable position, nothing on top), then returns the HostInput; the host injects it and
 * waits for idle. Nothing here depends on the platform: a provider that cannot inject a kind of input
 * rejects it with a clear error.
 */
import type { Direction, HostInput, Matcher, Point, Rect, Speed } from '@quiesco/protocol';

import { QuiescoError } from '../errors';
import type { HostNode, Viewport } from '../fiber-adapter';
import { summarize } from '../query';
import type { Clock } from '../sync';
import { center, describe, hitTest, isAncestor } from './hit-test';
import type { ActionPerformer } from './performer';
import * as value from './value';

export interface HostContext {
  clock: Clock;
  roots: () => readonly HostNode[];
  viewport: () => Viewport | null;
  matcher: Matcher;
  deadline: number;
}

const LONG_PRESS_MS = 800;
const STABLE_POLL_MS = 16;
const SCROLL_FRACTION = 0.8;

export function hostPerformer(ctx: HostContext): ActionPerformer {
  const sleep = (ms: number): Promise<void> =>
    new Promise((r) => {
      ctx.clock.setTimeout(r, ms);
    });

  /** The node's rect once it stops moving, after checking nothing covers the touch point (default: center). */
  const ready = async (node: HostNode, point?: Point): Promise<Rect> => {
    let prev: Rect | null = null;
    for (;;) {
      const rect = node.measure();
      if (rect === null) throw new QuiescoError('ELEMENT_NOT_FOUND', 'The element cannot be measured (unmounted?)', { matcher: ctx.matcher });
      const same = prev !== null && Math.abs(prev.x - rect.x) < 0.5 && Math.abs(prev.y - rect.y) < 0.5 && Math.abs(prev.width - rect.width) < 0.5;
      if (same || ctx.clock.now() >= ctx.deadline) {
        const top = hitTest(ctx.roots(), point === undefined ? center(rect) : { x: rect.x + point.x, y: rect.y + point.y });
        if (top !== null && !isAncestor(node, top)) {
          throw new QuiescoError('ELEMENT_OBSCURED', `${describe(node)} is covered by ${describe(top)}; a real click would not reach it`, {
            matcher: ctx.matcher,
            element: summarize(node, ctx.viewport()),
            obscuredBy: describe(top),
          });
        }
        return rect;
      }
      prev = rect;
      await sleep(STABLE_POLL_MS);
    }
  };

  const tapAt = async (node: HostNode, extra: { count?: number; holdMs?: number; point?: Point } = {}): Promise<HostInput> => {
    const rect = await ready(node, extra.point);
    const c = extra.point === undefined ? center(rect) : { x: rect.x + extra.point.x, y: rect.y + extra.point.y };
    const input: HostInput = { kind: 'tap', x: c.x, y: c.y };
    if (extra.count !== undefined) input.count = extra.count;
    if (extra.holdMs !== undefined) input.holdMs = extra.holdMs;
    return input;
  };

  const typeAt = async (node: HostNode, text: string, clearFirst: boolean): Promise<HostInput> => {
    const c = center(await ready(node));
    return { kind: 'type', x: c.x, y: c.y, text, clearFirst };
  };

  /** Wheel over the element (at `from`, normalized, when given); `down` reveals content below. */
  const wheel = async (node: HostNode, content: Direction, distance?: number, from?: Point): Promise<HostInput> => {
    const rect = await ready(node);
    const at = from === undefined ? center(rect) : { x: rect.x + from.x * rect.width, y: rect.y + from.y * rect.height };
    const vertical = content === 'up' || content === 'down';
    const d = distance ?? (vertical ? rect.height : rect.width) * SCROLL_FRACTION;
    const sign = content === 'down' || content === 'right' ? 1 : -1;
    return { kind: 'wheel', x: at.x, y: at.y, dx: vertical ? 0 : sign * d, dy: vertical ? sign * d : 0 };
  };

  const contentFor = (finger: Direction): Direction => ({ up: 'down', down: 'up', left: 'right', right: 'left' } as const)[finger];

  return {
    viaHost: true,
    tap: (node, point) => tapAt(node, point === undefined ? {} : { point }),
    longPress: (node, durationMs, point) => tapAt(node, { holdMs: durationMs ?? LONG_PRESS_MS, ...(point === undefined ? {} : { point }) }),
    multiTap: (node, count) => tapAt(node, { count }),
    type: (node, text) => typeAt(node, text, false),
    replaceText: (node, text) => typeAt(node, text, true),
    clear: (node) => typeAt(node, '', true),
    async pressKey(node, key) {
      // The key goes to the focused element; focusing puts the caret at the end of the text.
      if (!node.focus()) throw new QuiescoError('ACTION_NOT_SUPPORTED', `${describe(node)} cannot take the keyboard focus`, { action: 'pressKey', platform: 'web' });
      return { kind: 'key', key: key === 'enter' ? 'Enter' : 'Backspace' };
    },
    scroll: (node, direction, distance, from) => wheel(node, direction, distance, from),
    // A wheel moves content the way the finger swipe would (speed has no wheel equivalent).
    swipe: (node, direction, _speed?: Speed, distance?: number, from?: Point) => wheel(node, contentFor(direction), distance, from),
    async drag(node, to, holdMs, durationMs) {
      const from = center(await ready(node));
      return { kind: 'drag', from, to, durationMs, holdMs };
    },
    tapAt: async (point, holdMs) => ({ kind: 'tap', x: point.x, y: point.y, ...(holdMs === undefined ? {} : { holdMs }) }),

    /**
     * Real browser input where the DOM has it: `<select>` → selectOption, date / time inputs → fill,
     * a switch / checkbox → click (when it must change), a segment → click. Sliders, and components
     * that are not DOM form controls, are set through their callbacks (docs/api.md, value controls).
     */
    async setValue(control, v) {
      const node = control.node;
      if (node === null || value.isDisabledControl(control)) return value.jsSetValue(control, v, 'web');
      if (node.type === 'select' && (control.kind === 'picker' || control.kind === 'select')) {
        const i = value.pickerIndex(control, v, 'web');
        const c = center(await ready(node));
        return { kind: 'select', x: c.x, y: c.y, value: String((value.pickerItems(control)[i] as value.PickerItem).value) };
      }
      const inputType = node.type === 'input' ? String(node.props['type'] ?? 'text') : '';
      if (control.dom === 'input' && inputType !== 'range') {
        const c = center(await ready(node));
        return { kind: 'fill', x: c.x, y: c.y, value: value.inputString(inputType, v, 'web') };
      }
      if (control.kind === 'switch' || control.kind === 'checkbox') {
        if (typeof v !== 'boolean' || value.switchState(control) === v) return value.jsSetValue(control, v, 'web');
        return tapAt(node);
      }
      if (control.kind === 'segmented') {
        const i = value.segmentIndex(control, v, 'web');
        const n = value.segmentValues(control).length;
        const r = node.measure();
        if (i === control.props['selectedIndex'] || r === null || n === 0) return value.jsSetValue(control, v, 'web');
        return tapAt(node, { point: { x: ((i + 0.5) * r.width) / n, y: r.height / 2 } });
      }
      return value.jsSetValue(control, v, 'web');
    },

    /**
     * Mouse drag of the thumb. The thumb is the square child of the slider (react-native-community
     * slider's web implementation insets its track by half a thumb); the host injects the drag, so the
     * result is not read back here (the step's assertion does that).
     */
    async adjustSlider(node, control, position) {
      const rect = await ready(node);
      const thumb = findThumb(node, rect);
      const t = thumb?.width ?? 0;
      const lo = rect.x + t / 2;
      const hi = rect.x + rect.width - t / 2;
      const range = value.sliderRange(control.props);
      const current = typeof control.props['value'] === 'number' && range.max > range.min ? (control.props['value'] - range.min) / (range.max - range.min) : 0;
      const y = thumb === null ? rect.y + rect.height / 2 : thumb.y + thumb.height / 2;
      const from = thumb === null ? { x: lo + current * (hi - lo), y } : { x: thumb.x + thumb.width / 2, y };
      return { kind: 'drag', from, to: { x: lo + position * (hi - lo), y }, durationMs: 300, holdMs: 0 };
    },

    // The DOM has no accessibility actions (react-native-web drops accessibilityActions): callbacks.
    accessibilityAction: async (target, name) => value.jsAccessibilityAction(target, name, 'web'),
  };
}

/** A square descendant narrower than half the slider: the thumb. */
function findThumb(node: HostNode, rect: Rect): Rect | null {
  for (const c of node.children) {
    const r = c.measure();
    if (r !== null && r.width > 4 && Math.abs(r.width - r.height) < 1 && r.width < rect.width / 2) return r;
    const deeper = findThumb(c, rect);
    if (deeper !== null) return deeper;
  }
  return null;
}
