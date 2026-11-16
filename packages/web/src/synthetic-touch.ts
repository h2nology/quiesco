/**
 * Multi-finger input for browsers without CDP (Firefox, WebKit): the frames are played in the page as
 * synthetic events, the way a touch screen reports them (findings F.1 spike).
 * - PointerEvents (`pointerType: 'touch'`, one per changed finger) — what react-native-gesture-handler's
 *   web implementation listens to;
 * - TouchEvents where the page has them (Firefox: touch viewports only): one event per finger that goes
 *   down or up, one touchmove per target for the moved fingers — what react-native-web's responder
 *   system (PanResponder) listens to. Chromium's CDP Input.dispatchTouchEvent produces the same sequence.
 *   Touches come from `new Touch()` (Firefox) or, where that constructor is illegal, WebKit's
 *   `document.createTouch` / `createTouchList`.
 * Synthetic pointer ids are not active pointers, so `setPointerCapture` would throw NotFoundError:
 * while the gesture plays, the capture methods remember captures of those ids instead (moves and the
 * release then go to the capturing element, as with a real capture); other ids are untouched.
 * The events are not trusted (`isTrusted` false); gesture libraries do not look at it.
 */

export interface SyntheticTouchArgs {
  fingers: number;
  /** Flat frames `[tMs, down0, x0, y0, down1, x1, y1, ...]` (HostInput `touches`). */
  frames: number[];
}

/** Runs in the page (page.evaluate): self-contained, no imports or outer variables. */
export async function playSyntheticTouches({ fingers, frames }: SyntheticTouchArgs): Promise<void> {
  const ID_BASE = 1000;
  const stride = 1 + 3 * fingers;
  const ids = new Set<number>();
  const captured = new Map<number, Element>();
  const proto = Element.prototype;
  const orig = { set: proto.setPointerCapture, release: proto.releasePointerCapture, has: proto.hasPointerCapture };
  proto.setPointerCapture = function (this: Element, id: number): void {
    if (ids.has(id)) captured.set(id, this);
    else orig.set.call(this, id);
  };
  proto.releasePointerCapture = function (this: Element, id: number): void {
    if (ids.has(id)) {
      if (captured.get(id) === this) captured.delete(id);
    } else orig.release.call(this, id);
  };
  proto.hasPointerCapture = function (this: Element, id: number): boolean {
    return ids.has(id) ? captured.get(id) === this : orig.has.call(this, id);
  };

  interface Finger { x: number; y: number; target: Element }
  const down = new Map<number, Finger>();
  type LegacyDocument = Document & {
    createTouch?(view: Window, target: EventTarget, id: number, pageX: number, pageY: number, screenX: number, screenY: number): Touch;
    createTouchList?(...touches: Touch[]): TouchList;
  };
  const legacy = document as LegacyDocument;
  /** How this browser makes Touch objects: the constructor, WebKit's legacy factory, or none. */
  const touchKind = ((): 'ctor' | 'legacy' | 'none' => {
    if (typeof TouchEvent !== 'function') return 'none';
    try {
      new Touch({ identifier: 0, target: document.body });
      return 'ctor';
    } catch {
      return typeof legacy.createTouch === 'function' && typeof legacy.createTouchList === 'function' ? 'legacy' : 'none';
    }
  })();
  const primary = (): number | undefined => (down.size > 0 ? Math.min(...down.keys()) : undefined);

  const pointer = (type: 'pointerdown' | 'pointermove' | 'pointerup', i: number, f: Finger, isPrimary: boolean): void => {
    const id = ID_BASE + i;
    const pressed = type !== 'pointerup';
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: id,
      pointerType: 'touch',
      isPrimary,
      clientX: f.x,
      clientY: f.y,
      screenX: f.x,
      screenY: f.y,
      button: type === 'pointermove' ? -1 : 0,
      buttons: pressed ? 1 : 0,
      pressure: pressed ? 0.5 : 0,
      width: 10,
      height: 10,
    };
    (captured.get(id) ?? f.target).dispatchEvent(new PointerEvent(type, init));
  };
  const touchOf = (i: number, f: Finger): Touch =>
    touchKind === 'ctor'
      ? new Touch({ identifier: i, target: f.target, clientX: f.x, clientY: f.y, pageX: f.x + scrollX, pageY: f.y + scrollY, screenX: f.x, screenY: f.y, radiusX: 5, radiusY: 5, force: 1 })
      : (legacy.createTouch as NonNullable<LegacyDocument['createTouch']>)(window, f.target, i, f.x + scrollX, f.y + scrollY, f.x, f.y);
  // WebKit's TouchEventInit takes TouchLists only; the constructor's dictionaries take arrays.
  const list = (ts: Touch[]): Touch[] => (touchKind === 'legacy' ? ((legacy.createTouchList as NonNullable<LegacyDocument['createTouchList']>)(...ts) as unknown as Touch[]) : ts);
  const touch = (type: 'touchstart' | 'touchmove' | 'touchend', changed: [number, Finger][], target: Element): void => {
    if (touchKind === 'none') return;
    const touches = list([...down].map(([i, f]) => touchOf(i, f)));
    const targetTouches = list([...down].filter(([, f]) => f.target === target).map(([i, f]) => touchOf(i, f)));
    const changedTouches = list(changed.map(([i, f]) => touchOf(i, f)));
    target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches, targetTouches, changedTouches }));
  };

  const start = performance.now();
  try {
    for (let k = 0; k + stride <= frames.length; k += stride) {
      const wait = start + (frames[k] as number) - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const now = new Map<number, { x: number; y: number }>();
      for (let i = 0; i < fingers; i++) {
        const o = k + 1 + 3 * i;
        if ((frames[o] as number) > 0.5) now.set(i, { x: frames[o + 1] as number, y: frames[o + 2] as number });
      }
      for (const [i, p] of now) {
        if (down.has(i)) continue;
        const target = document.elementFromPoint(p.x, p.y) ?? document.body;
        const f = { ...p, target };
        ids.add(ID_BASE + i);
        const isPrimary = down.size === 0;
        down.set(i, f);
        pointer('pointerdown', i, f, isPrimary);
        touch('touchstart', [[i, f]], target);
      }
      const moved: [number, Finger][] = [];
      for (const [i, p] of now) {
        const f = down.get(i);
        if (f === undefined || (f.x === p.x && f.y === p.y)) continue;
        f.x = p.x;
        f.y = p.y;
        moved.push([i, f]);
      }
      const first = primary();
      for (const [i, f] of moved) pointer('pointermove', i, f, i === first);
      // A touchmove goes to each moved touch's own target (where it went down), one event per target.
      for (const target of new Set(moved.map(([, f]) => f.target))) {
        touch('touchmove', moved.filter(([, f]) => f.target === target), target);
      }
      for (const [i, f] of [...down]) {
        if (now.has(i)) continue;
        const isPrimary = i === primary();
        down.delete(i);
        pointer('pointerup', i, f, isPrimary);
        touch('touchend', [[i, f]], f.target);
      }
    }
    for (const [i, f] of [...down]) {
      const isPrimary = i === primary();
      down.delete(i);
      pointer('pointerup', i, f, isPrimary);
      touch('touchend', [[i, f]], f.target);
    }
  } finally {
    proto.setPointerCapture = orig.set;
    proto.releasePointerCapture = orig.release;
    proto.hasPointerCapture = orig.has;
  }
}
