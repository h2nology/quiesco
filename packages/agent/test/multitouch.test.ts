/** Phase 6.4: multi-finger frames, pinch / rotate geometry and the three performers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hostPerformer } from '../src/actions/host';
import type { FingerPath } from '../src/actions/multitouch';
import { FRAME_MS, MIN_RADIUS, framesFor, framesForSequence, pinchGestures, rotateGesture } from '../src/actions/multitouch';
import { nativePerformer } from '../src/actions/native';
import type { NativeBridge } from '../src/actions/native';
import { jsPerformer } from '../src/actions/performer';
import type { Clock } from '../src/sync';
import { tree } from './helpers/nodes';

const clock: Clock = { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as number), now: () => Date.now() };
const rect = { x: 100, y: 200, width: 200, height: 200 };
const viewport = { width: 400, height: 800 };

/** Frames as objects: per frame the time and each finger's point (null when up). */
function decode(frames: number[], fingers: number): { t: number; p: ({ x: number; y: number } | null)[] }[] {
  const stride = 1 + 3 * fingers;
  const out = [];
  for (let k = 0; k < frames.length; k += stride) {
    const p = [];
    for (let i = 0; i < fingers; i++) p.push(frames[k + 1 + 3 * i] === 1 ? { x: frames[k + 2 + 3 * i] as number, y: frames[k + 3 + 3 * i] as number } : null);
    out.push({ t: frames[k] as number, p });
  }
  return out;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
type P = { x: number; y: number };
/** Start and end point of the two fingers. */
const ends = (g: FingerPath[]) => g.map((f) => [f[0]![0], f[f.length - 1]![0]] as const) as unknown as [readonly [P, P], readonly [P, P]];

describe('frames', () => {
  it('interpolates every frame, and fingers go down / lift at their own times', () => {
    const a: FingerPath = [
      [{ x: 0, y: 0 }, 0],
      [{ x: 0, y: 100 }, 100],
    ];
    const b: FingerPath = [
      [{ x: 50, y: 50 }, 40],
      [{ x: 50, y: 50 }, 60],
    ];
    const f = decode(framesFor([a, b]), 2);
    expect(f[0]).toEqual({ t: 0, p: [{ x: 0, y: 0 }, null] });
    expect(f.every((fr, i) => i === 0 || fr.t > f[i - 1]!.t)).toBe(true);
    expect(f.find((fr) => fr.t === 40)?.p[1]).toEqual({ x: 50, y: 50 });
    expect(f.find((fr) => fr.t === 61)?.p[1]).toBeNull(); // b lifted right after its end
    expect(f.find((fr) => fr.t === 48)?.p[0]?.y).toBeCloseTo(48);
    expect(f.at(-2)?.p[0]).toEqual({ x: 0, y: 100 });
    expect(f.at(-1)?.p).toEqual([null, null]);
    expect(Math.max(...f.slice(1).map((fr, i) => fr.t - f[i]!.t))).toBeLessThanOrEqual(FRAME_MS);
  });

  it('sequences gestures with every finger up in between, later ones offset in time', () => {
    const tapAt = (x: number): FingerPath[] => [
      [
        [{ x, y: 0 }, 0],
        [{ x, y: 0 }, 50],
      ],
    ];
    const f = decode(framesForSequence([tapAt(1), tapAt(2)], 100), 1);
    const up = f.findIndex((fr) => fr.p[0] === null);
    expect(f[up]?.t).toBe(51);
    expect(f[up + 1]).toEqual({ t: 151, p: [{ x: 2, y: 0 }] });
  });
});

describe('pinch / rotate geometry', () => {
  it('zoom in: fingers start close on the element and end scale × further apart, symmetric around its center', () => {
    const [g, ...more] = pinchGestures(rect, 2, 0, 'normal', viewport);
    expect(more).toEqual([]);
    const [[a0, a1], [b0, b1]] = ends(g!);
    expect(dist(a1, b1) / dist(a0, b0)).toBeCloseTo(2);
    expect((a0.x + b0.x) / 2).toBeCloseTo(200);
    expect(dist(a0, b0)).toBeGreaterThanOrEqual(2 * MIN_RADIUS);
    for (const p of [a0, b0]) expect(p.x > rect.x && p.x < rect.x + rect.width).toBe(true);
  });

  it('zoom out starts wide on the element; an angle tilts the fingers; large factors are split', () => {
    const [[a0, a1], [b0, b1]] = ends(pinchGestures(rect, 0.5, 0, 'normal', viewport)[0]!);
    expect(dist(a1, b1) / dist(a0, b0)).toBeCloseTo(0.5);
    const [[c0], [d0]] = ends(pinchGestures(rect, 1.5, Math.PI / 4, 'normal', viewport)[0]!);
    expect(Math.abs(c0.x - d0.x)).toBeCloseTo(Math.abs(c0.y - d0.y));
    const many = pinchGestures(rect, 10, 0, 'normal', viewport);
    expect(many.length).toBeGreaterThan(1);
    const total = many.map((g) => {
      const [[x0, x1], [y0, y1]] = ends(g);
      return dist(x1, y1) / dist(x0, y0);
    });
    expect(total.reduce((p, f) => p * f, 1)).toBeCloseTo(10);
    for (const g of many) for (const f of g) for (const [p] of f) expect(p.x >= 0 && p.x <= viewport.width && p.y >= 0 && p.y <= viewport.height).toBe(true);
  });

  it('a slop lead-in: the fingers first move by the recognizer threshold, then by the factor', () => {
    const [[a0, a1], [b0, b1]] = ends(pinchGestures(rect, 2, 0, 'normal', viewport, 26)[0]!);
    const g = pinchGestures(rect, 2, 0, 'normal', viewport, 26)[0]!;
    const atActivation = dist(g[0]![2]![0], g[1]![2]![0]); // after the lead-in
    expect(atActivation - dist(a0, b0)).toBeCloseTo(26);
    expect(dist(a1, b1) / atActivation).toBeCloseTo(2);
    const left = ends(pinchGestures(rect, 0.5, 0, 'normal', viewport, 26)[0]!)[1]!;
    expect(left[0].x).toBeLessThan(left[1].x); // zoom out: the finger on the left moves right
    // Rotation: the turn includes the slop.
    const [r] = rotateGesture(rect, Math.PI / 2, 'normal', Math.PI / 18);
    const c = { x: 200, y: 300 };
    const end = r![r!.length - 1]![0];
    expect(Math.atan2(end.y - c.y, end.x - c.x)).toBeCloseTo(Math.PI / 2 + Math.PI / 18);
  });

  it('rejects elements too small for two fingers', () => {
    expect(() => pinchGestures({ x: 0, y: 0, width: 30, height: 30 }, 2, 0, 'normal', viewport)).toThrow(RangeError);
  });

  it('rotate: two opposite fingers follow the arc clockwise by the angle', () => {
    const [a, b] = rotateGesture(rect, Math.PI / 2, 'normal');
    const c = { x: 200, y: 300 };
    const start = a![0]![0];
    const end = a![a!.length - 1]![0];
    expect(dist(start, c)).toBeCloseTo(dist(end, c));
    // Clockwise on screen (y down): from the right of the center to below it.
    expect(start.x).toBeGreaterThan(c.x);
    expect(end.y).toBeGreaterThan(c.y);
    expect(end.x).toBeCloseTo(c.x);
    const mid = a![Math.floor(a!.length / 2)]![0];
    expect(dist(mid, c)).toBeCloseTo(dist(start, c)); // on the circle, not the chord
    expect(dist(b![0]![0], start)).toBeCloseTo(2 * dist(start, c));
  });
});

describe('performers', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('native: pinch plays two fingers through multiGesture; a pre-6.4 build asks for a rebuild', async () => {
    const multiGesture = vi.fn(async () => ({ handled: true }));
    const bridge: NativeBridge = {
      locate: async () => ({ found: true, ...rect, windowHasFocus: true }),
      tap: vi.fn(),
      swipe: vi.fn(),
      typeText: vi.fn(),
      multiGesture,
    };
    const roots = tree({ testID: 'box', tag: 5, rect });
    const p = nativePerformer({ bridge, clock, roots: () => roots, viewport: () => viewport, action: 'pinch', matcher: { id: 'box' }, deadline: Date.now() + 5000 });
    const done = p.pinch(roots[0]!, 2, 0, 'fast', 0);
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(multiGesture).toHaveBeenCalledWith(5, 2, expect.any(Array));
    const withoutMulti: NativeBridge = { locate: bridge.locate, tap: bridge.tap, swipe: bridge.swipe, typeText: bridge.typeText };
    const old = nativePerformer({ bridge: withoutMulti, clock, roots: () => roots, viewport: () => viewport, action: 'rotate', matcher: { id: 'box' }, deadline: Date.now() + 5000 });
    const failing = old.rotate(roots[0]!, 1, 'fast', 0);
    failing.catch(() => {});
    await vi.advanceTimersByTimeAsync(100);
    await expect(failing).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', message: expect.stringContaining('multiGesture') });
  });

  it('host: touches input for the browser; js: not supported', async () => {
    const roots = tree({ testID: 'box', rect });
    const host = hostPerformer({ clock, roots: () => roots, viewport: () => viewport, matcher: { id: 'box' }, deadline: 0 });
    await expect(host.rotate(roots[0]!, 1, 'fast', 0)).resolves.toMatchObject({ kind: 'touches', fingers: 2 });
    const fingers: FingerPath[] = [
      [
        [{ x: 1, y: 1 }, 0],
        [{ x: 1, y: 9 }, 30],
      ],
    ];
    await expect(host.multiTouch(null, fingers)).resolves.toMatchObject({ kind: 'touches', fingers: 1 });
    await expect(jsPerformer({ platform: 'ios' }).pinch(roots[0]!, 2, 0, 'fast', 0)).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
  });
});
