/**
 * Real scrolling of wheel pickers (iOS UIPickerView, and UIDatePicker in wheels style) in native mode
 * (HU 2026-11-09; findings.md "6.3 spike").
 *
 * The native module reports each column's touch area (found by hit testing), row height, selected row
 * and — for a date picker — the date. A wheel is turned by a slow drag that rests before the finger
 * lifts, so it does not fling; the result is read back once the wheel has stopped and corrected with
 * further drags. Date pickers: which calendar unit a column turns (year, month, day, hour ...) depends
 * on the locale, so each column is probed with a one-row drag and the date before / after compared.
 */
import { QuiescoError } from '../errors';
import type { Clock } from '../sync';

/** The parts of @quiesco/native's wheelInfo used here. */
export interface WheelColumn {
  selectedRow: number;
  rows: number;
  rowHeight: number;
  title: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface WheelState {
  found: boolean;
  components?: WheelColumn[];
  moving?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  date?: number;
  /** UIDatePicker.Mode: 0 time, 1 date, 2 date and time, 3 countdown. */
  datePickerMode?: number;
}

export interface WheelContext {
  read(): Promise<WheelState>;
  /** One finger along a timed path ([point, ms]), window coordinates. */
  gesture(path: [{ x: number; y: number }, number][]): Promise<void>;
  clock: Clock;
  deadline: number;
  /** Window height, to keep long drags on screen. */
  viewportHeight: number | null;
  platform: string;
}

const POLL_MS = 40;
/** Readings that must agree (wheel at rest and values unchanged) before a wheel counts as stopped. */
const STABLE_READS = 3;
/** The finger rests this long before lifting: no velocity, no fling. */
const REST_MS = 250;
const PRESS_MS = 60;
const MAX_TRAVEL = 360;
const MAX_ATTEMPTS = 12;

function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise((r) => {
    clock.setTimeout(r, ms);
  });
}

function snapshot(s: WheelState): string {
  return JSON.stringify([s.date ?? null, (s.components ?? []).map((c) => c.selectedRow)]);
}

/** The wheel once it has stopped: not moving, and the same selection / date over a few readings. */
export async function settle(ctx: WheelContext): Promise<WheelState> {
  let last = '';
  let same = 0;
  for (;;) {
    const s = await ctx.read();
    if (!s.found) throw new QuiescoError('ELEMENT_NOT_FOUND', 'The wheel picker disappeared', { matcher: {} });
    const key = snapshot(s);
    same = s.moving !== true && key === last ? same + 1 : 0;
    last = key;
    if (same >= STABLE_READS - 1 || ctx.clock.now() >= ctx.deadline) return s;
    await sleep(ctx.clock, POLL_MS);
  }
}

function column(s: WheelState, c: number): Required<Pick<WheelColumn, 'x' | 'width'>> & WheelColumn {
  const col = s.components?.[c];
  if (col === undefined || col.x === undefined || col.width === undefined || col.width <= 0) {
    throw new QuiescoError('ACTION_NOT_SUPPORTED', `wheel column ${c} takes no touches (nothing to drag)`, { action: 'setValue', platform: 'native' });
  }
  return col as Required<Pick<WheelColumn, 'x' | 'width'>> & WheelColumn;
}

/** Turn column `c` by `rows` (positive: towards later rows, i.e. the finger moves up). At most what fits in one drag. */
async function turn(ctx: WheelContext, s0: WheelState, c: number, rows: number): Promise<void> {
  // A column takes no touches while UIKit animates it (e.g. the app re-selected the row): wait.
  let s = s0;
  while (!(s.components?.[c]?.width !== undefined && (s.components[c]?.width ?? 0) > 0) && ctx.clock.now() < ctx.deadline) {
    await sleep(ctx.clock, POLL_MS);
    s = await ctx.read();
  }
  const col = column(s, c);
  const top = s.y ?? 0;
  const bottom = top + (s.height ?? 0);
  const maxRows = Math.max(1, Math.floor(MAX_TRAVEL / col.rowHeight));
  const n = Math.max(-maxRows, Math.min(maxRows, rows));
  const d = Math.abs(n) * col.rowHeight;
  const x = col.x + col.width / 2;
  // The finger must go down on the wheel; it may leave it while moving (the scroll view keeps tracking).
  // Turning to later rows moves the finger up: start low on the wheel, and vice versa.
  const cy = (top + bottom) / 2;
  const inset = Math.min(col.rowHeight, (bottom - top) / 4);
  let from = n > 0 ? Math.min(cy + d / 2, bottom - inset) : Math.max(cy - d / 2, top + inset);
  let to = n > 0 ? from - d : from + d;
  // Keep the finger on screen.
  const h = ctx.viewportHeight;
  if (h !== null) {
    if (to < 4) to = 4;
    if (to > h - 4) to = h - 4;
    from = n > 0 ? Math.min(from, to + d) : Math.max(from, to - d);
  }
  const moveMs = 150 + d * 3;
  await ctx.gesture([
    [{ x, y: from }, 0],
    [{ x, y: from }, PRESS_MS],
    [{ x, y: to }, PRESS_MS + moveMs],
    [{ x, y: to }, PRESS_MS + moveMs + REST_MS],
  ]);
}

function giveUp(what: string, platform: string): QuiescoError {
  return new QuiescoError('ACTION_NOT_SUPPORTED', `setValue could not turn the wheel to ${what}`, {
    action: 'setValue',
    platform,
    hint: 'the wheel did not land on the target after several drags; pass { mode: "js" } to set it through its callbacks',
  });
}

/** Turn column `c` until row `target` is selected. */
export async function selectRow(ctx: WheelContext, c: number, target: number): Promise<WheelState> {
  let s = await settle(ctx);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const cur = s.components?.[c]?.selectedRow ?? -1;
    if (cur === target) return s;
    await turn(ctx, s, c, target - cur);
    s = await settle(ctx);
  }
  if ((s.components?.[c]?.selectedRow ?? -1) === target) return s;
  throw giveUp(`row ${target} (it shows row ${s.components?.[c]?.selectedRow ?? '?'})`, ctx.platform);
}

// ---- date pickers ----

export type DateUnit = 'year' | 'month' | 'day' | 'date' | 'hour' | 'minute' | 'ampm';

interface Fields {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function fields(ms: number): Fields {
  const t = new Date(ms);
  return { y: t.getFullYear(), mo: t.getMonth(), d: t.getDate(), h: t.getHours(), mi: t.getMinutes() };
}

function dayNumber(f: Fields): number {
  return Math.round(Date.UTC(f.y, f.mo, f.d) / 86400000);
}

/**
 * The unit a column turned, from the date before and after a one-row turn. `mode` 2 (date and time)
 * has a single date column (a list of days); `mode` 1 has separate year / month / day wheels.
 */
export function classifyTurn(before: number, after: number, mode: number): { unit: DateUnit; step: number } | null {
  const a = fields(before);
  const b = fields(after);
  const sameDay = a.y === b.y && a.mo === b.mo && a.d === b.d;
  const sameTime = a.h === b.h && a.mi === b.mi;
  if (!sameDay && sameTime) {
    if (mode === 2) return { unit: 'date', step: 1 };
    if (a.y !== b.y && a.mo === b.mo) return { unit: 'year', step: 1 };
    if (a.mo !== b.mo) return { unit: 'month', step: 1 };
    return { unit: 'day', step: 1 };
  }
  if (sameDay && !sameTime) {
    if (a.mi !== b.mi && a.h === b.h) {
      const dm = Math.abs(b.mi - a.mi);
      return { unit: 'minute', step: Math.min(dm, 60 - dm) };
    }
    if (Math.abs(b.h - a.h) === 12 && a.mi === b.mi) return { unit: 'ampm', step: 1 };
    return { unit: 'hour', step: 1 };
  }
  return null;
}

/** Rows to turn a column of `unit` from `cur` to `target` (12-hour wheels count hours modulo 12). */
export function rowsFor(unit: DateUnit, step: number, cur: Fields, target: Fields, twelveHour: boolean): number {
  switch (unit) {
    case 'year':
      return target.y - cur.y;
    case 'month':
      return target.mo - cur.mo;
    case 'day':
      return target.d - cur.d;
    case 'date':
      return dayNumber(target) - dayNumber(cur);
    case 'hour':
      return twelveHour ? (target.h % 12) - (cur.h % 12) : target.h - cur.h;
    case 'ampm':
      return (target.h >= 12 ? 1 : 0) - (cur.h >= 12 ? 1 : 0);
    case 'minute':
      return Math.round((target.mi - cur.mi) / Math.max(1, step));
  }
}

function matches(cur: Fields, target: Fields, mode: number): boolean {
  const day = cur.y === target.y && cur.mo === target.mo && cur.d === target.d;
  const time = cur.h === target.h && cur.mi === target.mi;
  return mode === 1 ? day : mode === 0 ? time : day && time;
}

/** Turn the wheels of a UIDatePicker until it shows `target` (date part, time part or both by mode). */
export async function selectDate(ctx: WheelContext, target: Date): Promise<WheelState> {
  let s = await settle(ctx);
  const mode = s.datePickerMode ?? 1;
  if (mode === 3) throw new QuiescoError('ACTION_NOT_SUPPORTED', 'countdown timers are not supported by setValue', { action: 'setValue', platform: ctx.platform });
  const n = s.components?.length ?? 0;
  const twelveHour = (mode === 0 && n === 3) || (mode === 2 && n === 4);
  const t = fields(target.getTime());
  const units: ({ unit: DateUnit; step: number } | null)[] = [];
  for (let pass = 0; pass < 4; pass++) {
    for (let c = 0; c < n; c++) {
      if (s.date === undefined) throw new QuiescoError('ACTION_NOT_SUPPORTED', 'the wheel picker reports no date', { action: 'setValue', platform: ctx.platform });
      if (matches(fields(s.date), t, mode)) return s;
      if (units[c] === undefined) {
        // Probe: one row towards later rows (earlier at the end of a non-cyclic wheel).
        const col = s.components?.[c];
        const dir = col !== undefined && col.selectedRow >= col.rows - 1 ? -1 : 1;
        const before = s.date;
        await turn(ctx, s, c, dir);
        s = await settle(ctx);
        const k = s.date === undefined ? null : classifyTurn(before, s.date, mode);
        units[c] = k;
      }
      const u = units[c];
      if (u === null || u === undefined || s.date === undefined) continue;
      let rows = rowsFor(u.unit, u.step, fields(s.date), t, twelveHour);
      for (let i = 0; rows !== 0 && i < MAX_ATTEMPTS; i++) {
        await turn(ctx, s, c, rows);
        s = await settle(ctx);
        if (s.date === undefined) break;
        rows = rowsFor(u.unit, u.step, fields(s.date), t, twelveHour);
      }
    }
  }
  if (s.date !== undefined && matches(fields(s.date), t, mode)) return s;
  const shown = s.date === undefined ? '?' : new Date(s.date).toString();
  throw giveUp(`${target.toString()} (it shows ${shown})`, ctx.platform);
}
