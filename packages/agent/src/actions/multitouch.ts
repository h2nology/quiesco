/**
 * Multi-finger gestures (Phase 6.4): finger paths, pinch / rotate geometry and the frame format the
 * native modules and the web host play back.
 *
 * Frames (flat numbers, `1 + 3 × fingers` per frame): `[tMs, down0, x0, y0, down1, x1, y1, ...]`, window
 * coordinates, t from 0. A finger goes down in the first frame it is down and lifts in the first frame
 * it is not; the last frame has every finger up (players also lift any finger still down after it).
 */
import type { Point, Rect, Speed } from '@quiesco/protocol';

import type { Viewport } from '../fiber-adapter';

/** One finger: window points with the time (ms from the gesture's start) it reaches them. */
export type FingerPath = [Point, number][];

/** Frame interval: one per display frame, like a touchscreen's report rate. */
export const FRAME_MS = 16;
/** Fingers rest before moving (the recognizers see both touches) and before lifting (no fling). */
export const PRESS_MS = 80;
export const REST_MS = 150;
/** Fingers closer than this merge on a real screen; pinches keep them apart. */
export const MIN_RADIUS = 20;
/** Keep fingers this far inside the window. */
const EDGE = 8;

const PINCH_MS: Record<Speed, number> = { slow: 1200, normal: 600, fast: 300 };
/** Rotation time per radian. */
const ROTATE_MS_PER_RAD: Record<Speed, number> = { slow: 800, normal: 400, fast: 200 };

function at(path: FingerPath, t: number): Point {
  const first = path[0] as [Point, number];
  if (t <= first[1]) return first[0];
  for (let k = 1; k < path.length; k++) {
    const [b, tb] = path[k] as [Point, number];
    if (t <= tb) {
      const [a, ta] = path[k - 1] as [Point, number];
      const f = tb === ta ? 1 : (t - ta) / (tb - ta);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return (path[path.length - 1] as [Point, number])[0];
}

/** Frames for fingers that may start and end at different times (each is down from its first to its last point). */
export function framesFor(fingers: readonly FingerPath[], stepMs = FRAME_MS): number[] {
  const spans = fingers.map((p) => [(p[0] as [Point, number])[1], (p[p.length - 1] as [Point, number])[1]] as const);
  const times = new Set<number>();
  const start = Math.min(...spans.map((s) => s[0]));
  const end = Math.max(...spans.map((s) => s[1]));
  for (let t = start; t < end; t += stepMs) times.add(Math.round(t));
  for (const [s, e] of spans) {
    times.add(s);
    times.add(e);
    times.add(e + 1); // the frame where a finger that ends early lifts
  }
  const out: number[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    if (t > end + 1) continue;
    out.push(t - start);
    fingers.forEach((path, i) => {
      const [s, e] = spans[i] as readonly [number, number];
      if (t < s || t > e) {
        out.push(0, 0, 0);
      } else {
        const p = at(path, t);
        out.push(1, p.x, p.y);
      }
    });
  }
  return out;
}

/** Gestures one after another (all fingers up in between, `gapMs` apart), as one frame list. */
export function framesForSequence(gestures: readonly (readonly FingerPath[])[], gapMs = 120): number[] {
  const n = Math.max(...gestures.map((g) => g.length));
  const out: number[] = [];
  let offset = 0;
  for (const g of gestures) {
    const frames = framesFor(g);
    const own = 1 + 3 * g.length;
    let last = 0;
    for (let k = 0; k < frames.length; k += own) {
      last = (frames[k] as number) + offset;
      out.push(last);
      for (let i = 0; i < n; i++) {
        if (i < g.length) out.push(frames[k + 1 + 3 * i] as number, frames[k + 2 + 3 * i] as number, frames[k + 3 + 3 * i] as number);
        else out.push(0, 0, 0);
      }
    }
    // framesFor ends with every finger up (the frame after the last end).
    offset = last + gapMs;
  }
  return out;
}

const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** How far from `c` a finger can go along direction (dx, dy) and stay in the window. */
function reach(c: Point, dx: number, dy: number, viewport: Viewport | null): number {
  if (viewport === null) return Number.POSITIVE_INFINITY;
  let r = Number.POSITIVE_INFINITY;
  for (const [d, pos, size] of [
    [dx, c.x, viewport.width],
    [dy, c.y, viewport.height],
  ] as const) {
    if (d > 1e-9) r = Math.min(r, (size - EDGE - pos) / d);
    else if (d < -1e-9) r = Math.min(r, (pos - EDGE) / -d);
  }
  return r;
}

/** Half the element's extent along the direction, inset: where fingers can go down on it. */
function inside(rect: Rect, dx: number, dy: number): number {
  const hx = Math.abs(dx) < 1e-9 ? Number.POSITIVE_INFINITY : rect.width / 2 / Math.abs(dx);
  const hy = Math.abs(dy) < 1e-9 ? Number.POSITIVE_INFINITY : rect.height / 2 / Math.abs(dy);
  return Math.min(hx, hy) * 0.85;
}

function twoFingers(c: Point, dx: number, dy: number, rStart: number, r0: number, r1: number, moveMs: number): FingerPath[] {
  const p = (r: number, s: number): Point => ({ x: c.x + s * r * dx, y: c.y + s * r * dy });
  // Lead-in (rStart → r0) at the same speed as the counted part.
  const leadMs = Math.abs(r1 - r0) < 1e-9 ? 0 : (moveMs * Math.abs(r0 - rStart)) / Math.abs(r1 - r0);
  return [1, -1].map((s) => [
    [p(rStart, s), 0],
    [p(rStart, s), PRESS_MS],
    [p(r0, s), PRESS_MS + leadMs],
    [p(r1, s), PRESS_MS + leadMs + moveMs],
    [p(r1, s), PRESS_MS + leadMs + moveMs + REST_MS],
  ]);
}

/**
 * Pinches that scale the distance between two fingers by `scale` in total, centered on the element, the
 * fingers on a line at `angle` (radians, 0 = horizontal). The fingers go down on the element and stay in
 * the window; a factor that does not fit in one pinch is split into equal pinches (as a user repeats).
 * `slop`: the distance change before the app's recognizer activates (and starts measuring); each pinch
 * moves that much first, so the recognizer reports `scale`.
 */
export function pinchGestures(rect: Rect, scale: number, angle: number, speed: Speed, viewport: Viewport | null, slop = 0): FingerPath[][] {
  const c = center(rect);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const half = inside(rect, dx, dy);
  const maxR = Math.min(reach(c, dx, dy, viewport), reach(c, -dx, -dy, viewport));
  const lead = slop / 2; // per finger
  if (half < MIN_RADIUS * 1.2 + lead || maxR < MIN_RADIUS * 1.2 + lead) {
    throw new RangeError(`the element (${Math.round(rect.width)}×${Math.round(rect.height)}) is too small for two fingers`);
  }
  // Zoom in: start close together on the element; zoom out: start wide apart on it.
  const zoomIn = scale >= 1;
  const rStart = zoomIn ? Math.max(MIN_RADIUS, half * 0.4 - lead) : Math.min(half, maxR);
  const r0 = zoomIn ? rStart + lead : rStart - lead;
  const limit = zoomIn ? maxR / r0 : MIN_RADIUS / r0;
  const n = Math.max(1, Math.ceil(Math.log(scale) / Math.log(limit) - 1e-9));
  const f = scale ** (1 / n);
  const moveMs = PINCH_MS[speed];
  return Array.from({ length: n }, () => twoFingers(c, dx, dy, rStart, r0, r0 * f, moveMs));
}

/**
 * Two fingers turning `radians` (positive: clockwise on screen) around the element's center, on a
 * circle that fits the element; sampled every frame so the fingers follow the arc. `slop`: the
 * rotation before the app's recognizer activates, added to the turn.
 */
export function rotateGesture(rect: Rect, radians: number, speed: Speed, slop = 0): FingerPath[] {
  const c = center(rect);
  const r = Math.max(MIN_RADIUS * 1.5, Math.min(rect.width, rect.height) / 2 * 0.6);
  // The recognizer measures from where it activates: turn `slop` more (same direction) in total.
  const total = radians + Math.sign(radians) * slop;
  const moveMs = Math.max(250, Math.abs(total) * ROTATE_MS_PER_RAD[speed]);
  const steps = Math.max(2, Math.ceil(moveMs / FRAME_MS));
  return [0, Math.PI].map((phase) => {
    const p = (a: number): Point => ({ x: c.x + r * Math.cos(phase + a), y: c.y + r * Math.sin(phase + a) });
    const path: FingerPath = [[p(0), 0]];
    for (let k = 0; k <= steps; k++) path.push([p((total * k) / steps), PRESS_MS + (moveMs * k) / steps]);
    path.push([p(total), PRESS_MS + moveMs + REST_MS]);
    return path;
  });
}
