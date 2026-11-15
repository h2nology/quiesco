/**
 * Date / time picker values (issue #18). The native Android dialogs change only their part of the
 * picker's `value` (@react-native-community/datetimepicker: the date dialog keeps the hours and minutes,
 * the time dialog keeps the day; seconds and milliseconds become 0), in the picker's time zone
 * (`timeZoneOffsetInMinutes`, else the device's). setValue does the same, and also takes local strings
 * ("2031-12-24", "20:15", "2031-12-24T20:15") so tests need not invent a day or care about time zones.
 * The value an element reports is the same kind of string, so expectValue compares what the picker shows.
 */

export type PickerMode = 'date' | 'time' | 'datetime' | 'countdown';

interface DayParts {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
}

interface TimeParts {
  hour: number;
  minute: number;
  second: number;
}

type Parts = DayParts & TimeParts;

type Props = Readonly<Record<string, unknown>>;

/** The picker's `mode` (datetimepicker's default: date). */
export function pickerMode(props: Props): PickerMode {
  const m = props['mode'];
  return m === 'time' || m === 'datetime' || m === 'countdown' ? m : 'date';
}

/** `timeZoneOffsetInMinutes` when set (a fixed offset from UTC); null: the device's time zone. */
export function pickerOffset(props: Props): number | null {
  const o = props['timeZoneOffsetInMinutes'];
  return typeof o === 'number' && Number.isFinite(o) ? o : null;
}

function partsOf(d: Date, offset: number | null): Parts {
  if (offset === null) {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() };
  }
  const s = new Date(d.getTime() + offset * 60_000);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate(), hour: s.getUTCHours(), minute: s.getUTCMinutes(), second: s.getUTCSeconds() };
}

function dateOf(p: Parts, offset: number | null): Date {
  if (offset === null) return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0) - offset * 60_000);
}

/** A local date and / or time string: "2031-12-24", "20:15", "20:15:30", "2031-12-24T20:15" (or a space). null otherwise. */
export function parseLocal(s: string): { day?: DayParts; time?: TimeParts } | null {
  const m = /^(?:(\d{4})-(\d{2})-(\d{2}))?(?:(?:^|[T ])(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim());
  if (m === null || (m[1] === undefined && m[4] === undefined)) return null;
  const out: { day?: DayParts; time?: TimeParts } = {};
  if (m[1] !== undefined) {
    const day = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    const check = new Date(day.year, day.month - 1, day.day);
    if (check.getFullYear() !== day.year || check.getMonth() !== day.month - 1 || check.getDate() !== day.day) return null;
    out.day = day;
  }
  if (m[4] !== undefined) {
    const time = { hour: Number(m[4]), minute: Number(m[5]), second: m[6] !== undefined ? Number(m[6]) : 0 };
    if (time.hour > 23 || time.minute > 59 || time.second > 59) return null;
    out.time = time;
  }
  return out;
}

const FORMS = '"2031-12-24" (date), "20:15" (time) or "2031-12-24T20:15"';

/**
 * The Date the picker ends up with when the user picks `input`, given its current `value`. Throws (a
 * message) for input the picker cannot take: a time for a date picker, a day for a time picker, a
 * malformed string.
 */
export function resolvePickerDate(current: Date, input: Date | string, mode: PickerMode, offset: number | null): Date {
  const now = partsOf(current, offset);
  let day: DayParts | undefined;
  let time: TimeParts | undefined;
  if (input instanceof Date) {
    // datetime / countdown pickers set the whole value, as before.
    if (mode === 'datetime' || mode === 'countdown') return input;
    const p = partsOf(input, offset);
    day = p;
    time = p;
  } else {
    if (mode === 'countdown') throw new Error('a countdown picker takes a Date');
    const parsed = parseLocal(input);
    if (parsed === null) throw new Error(`a date / time picker takes a Date or a local ${FORMS}, got ${JSON.stringify(input)}`);
    day = parsed.day;
    time = parsed.time;
    if (mode === 'date' && day === undefined) throw new Error(`a date picker (mode="date") takes a day such as "2031-12-24", got ${JSON.stringify(input)}`);
    if (mode === 'time' && time === undefined) throw new Error(`a time picker (mode="time") takes a time such as "20:15", got ${JSON.stringify(input)}`);
  }
  switch (mode) {
    case 'date':
      // The date dialog: the picked day, the value's hours and minutes, no seconds.
      return dateOf({ ...(day as DayParts), hour: now.hour, minute: now.minute, second: 0 }, offset);
    case 'time':
      // The time dialog: the value's day, the picked hours and minutes (seconds only when a string gives them).
      return dateOf({ ...now, hour: (time as TimeParts).hour, minute: (time as TimeParts).minute, second: input instanceof Date ? 0 : (time as TimeParts).second }, offset);
    default:
      // datetime with a string: what it gives, the rest from the value.
      return dateOf({ ...now, ...(day ?? {}), ...(time ?? { hour: now.hour, minute: now.minute, second: 0 }) }, offset);
  }
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
const dayString = (p: DayParts): string => `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
const timeString = (p: TimeParts, seconds: boolean): string => `${pad(p.hour)}:${pad(p.minute)}${seconds ? `:${pad(p.second)}` : ''}`;

/** What the picker shows, as a local string: "2031-12-24" (date), "20:15" (time), "2031-12-24T20:15" (datetime / countdown); seconds when not 0. */
export function formatPickerValue(d: Date, mode: PickerMode, offset: number | null): string {
  const p = partsOf(d, offset);
  if (mode === 'date') return dayString(p);
  if (mode === 'time') return timeString(p, p.second !== 0);
  return `${dayString(p)}T${timeString(p, p.second !== 0)}`;
}

/**
 * expectValue with a Date on a date / time picker: compare the parts the picker's value shows (the shape
 * of `actual`, from formatPickerValue), in the device's local time.
 */
export function pickerValueMatches(actual: string, expected: Date): boolean {
  const parsed = parseLocal(actual);
  if (parsed === null) return false;
  const p = partsOf(expected, null);
  const seconds = parsed.time !== undefined && /:\d{2}:\d{2}$/.test(actual);
  const want = parsed.day !== undefined && parsed.time !== undefined ? `${dayString(p)}T${timeString(p, seconds || p.second !== 0)}` : parsed.day !== undefined ? dayString(p) : timeString(p, seconds || p.second !== 0);
  return want === actual;
}
