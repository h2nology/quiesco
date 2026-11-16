/**
 * Value controls (Phase 6.3): `setValue`, `adjustSlider` and `accessibilityAction`.
 *
 * A control is found by the shape of the props of the nearest component around the target (the
 * element, then its ancestors, a few levels up — see HostNode.findProps), so it works with the
 * community components without depending on their (minified) names:
 * - date: `value` is a Date and there is `onChange` / `onValueChange` (@react-native-community/datetimepicker);
 * - segmented: a `values` array and `onChange` / `onValueChange` (@react-native-segmented-control);
 * - picker: `onValueChange` and a `selectedValue` prop (@react-native-picker/picker);
 * - switch: a boolean `value` and `onValueChange` (Switch, expo-checkbox);
 * - slider: `onValueChange` / `onSlidingComplete` and a numeric `value` or a `minimumValue` / `maximumValue`
 *   (@react-native-community/slider).
 * DOM form controls (`<select>`, `<input type="date">` ...) rendered on the web are recognized by
 * their host type when no such component owns them.
 *
 * This module is the `js` mode: it calls the component's callbacks with the events the native
 * component would send. Real-input modes (actions/native.ts, actions/host.ts) use it to read the
 * control and fall back to it where no real input exists (documented per control in docs/api.mdx).
 */
import type { ControlValue, DateValue } from '@quiesco/protocol';

import { pickerMode, pickerOffset, resolvePickerDate } from '../date-value';
import { QuiescoError } from '../errors';
import type { CompositeNode, HostNode } from '../fiber-adapter';

export type ControlKind = 'slider' | 'switch' | 'picker' | 'segmented' | 'date' | 'select' | 'input' | 'checkbox';

/** The DOM form control behind an element on the web. */
export type DomKind = 'select' | 'input' | 'checkbox';

export interface Control {
  kind: ControlKind;
  /** Props of the component that owns the value (or of the DOM element for DOM kinds). */
  props: Readonly<Record<string, unknown>>;
  /** Component name, when known (diagnostics). */
  name: string | null;
  /** The targeted host element; null for a component that renders none (Android DateTimePicker). */
  node: HostNode | null;
  /** The element is a DOM form control (web). */
  dom?: DomKind;
}

export interface PickerItem {
  value: unknown;
  label: string;
}

type Props = Readonly<Record<string, unknown>>;
type Fn = (...args: unknown[]) => unknown;

const isFn = (v: unknown): v is Fn => typeof v === 'function';

function classify(p: Props): ControlKind | null {
  const change = isFn(p['onChange']) || isFn(p['onValueChange']);
  if (p['value'] instanceof Date && change) return 'date';
  if (Array.isArray(p['values']) && change) return 'segmented';
  if (isFn(p['onValueChange']) && 'selectedValue' in p) return 'picker';
  if (typeof p['value'] === 'boolean' && isFn(p['onValueChange'])) return 'switch';
  if ((isFn(p['onValueChange']) || isFn(p['onSlidingComplete'])) && (typeof p['value'] === 'number' || 'minimumValue' in p || 'maximumValue' in p)) return 'slider';
  return null;
}

/** The props are a value control's (slider, switch, picker, segmented control, date picker). */
export function isValueControl(p: Props): boolean {
  return classify(p) !== null;
}

/**
 * Issue #29: an element with no size whose component is a value control (e.g. @expo/ui's DateTimePicker,
 * whose SwiftUI / Compose view reports 0 height to React Native while it is drawn). Not reachable by a
 * touch: value actions on it call the control's callbacks.
 */
export function isSizelessControl(node: HostNode): boolean {
  const r = node.measure();
  return r !== null && (r.width <= 0 || r.height <= 0) && node.findProps((p) => classify(p) !== null) !== null;
}

const DATE_INPUTS: ReadonlySet<string> = new Set(['date', 'time', 'datetime-local', 'month', 'week']);
const VALUE_INPUTS: ReadonlySet<string> = new Set([...DATE_INPUTS, 'range', 'number', 'color']);

function domKind(node: HostNode): DomKind | undefined {
  if (node.type === 'select') return 'select';
  if (node.type !== 'input') return undefined;
  const t = String(node.props['type'] ?? 'text');
  if (t === 'checkbox' || t === 'radio') return 'checkbox';
  return VALUE_INPUTS.has(t) ? 'input' : undefined;
}

/**
 * Component kinds that render a DOM control of the given kind themselves (react-native-web's Switch,
 * @react-native-picker/picker's web Picker). A value `<input>` belongs to no component kind: no community
 * component renders one (datetimepicker has no web implementation), so a component with a Date `value`
 * around it is the app's own wrapper, whose callbacks have the app's signature (measured: calling it as
 * a datetimepicker crashed the example's DateField).
 */
const DOM_OWNERS: Readonly<Record<DomKind, readonly ControlKind[]>> = {
  select: ['picker'],
  checkbox: ['switch'],
  input: [],
};

function isHostNode(t: HostNode | CompositeNode): t is HostNode {
  return 'measure' in t;
}

export function unsupported(action: 'setValue' | 'adjustSlider' | 'accessibilityAction', message: string, platform: string, hint?: string): QuiescoError {
  return new QuiescoError('ACTION_NOT_SUPPORTED', message, { action, platform, ...(hint !== undefined ? { hint } : {}) });
}

/** Function props of the element and the components around it (for "what could be called" errors). */
function callbacks(target: HostNode | CompositeNode): string[] {
  const names = new Set<string>();
  const add = (p: Props): void => {
    for (const [k, v] of Object.entries(p)) if (isFn(v) && /^on[A-Z]/.test(k)) names.add(k);
  };
  add(target.props);
  if (isHostNode(target)) add(target.ownerProps());
  return [...names].sort();
}

/** The value control behind `target`, or ACTION_NOT_SUPPORTED naming the callbacks that were found. */
export function detectControl(target: HostNode | CompositeNode, platform: string): Control {
  const node = isHostNode(target) ? target : null;
  const dom = node === null ? undefined : domKind(node);
  const found = target.findProps((p) => classify(p) !== null);
  const kind = found === null ? null : classify(found.props);
  if (found !== null && kind !== null && (dom === undefined || DOM_OWNERS[dom].includes(kind))) {
    return { kind, props: found.props, name: found.name, node, ...(dom !== undefined ? { dom } : {}) };
  }
  if (node !== null && dom !== undefined) return { kind: dom, props: node.props, name: null, node, dom };
  // A container holding exactly one control (e.g. a View with the testID around a component that
  // does not pass testID on, like segmented-control's JS implementation on Android / web).
  if (node !== null) {
    const inside = controlsBelow(node);
    const only = inside.length === 1 ? (inside[0] as Inside) : null;
    if (only !== null) return { kind: only.kind, props: only.props, name: only.name, node: only.node };
  }
  const cbs = callbacks(target);
  throw unsupported(
    'setValue',
    `setValue does not know this element: no slider, switch, picker, segmented control or date picker found around it` +
      (cbs.length > 0 ? ` (callbacks found: ${cbs.join(', ')})` : ' (it has no callbacks)') +
      searchReport(target, node),
    platform,
    'text inputs: use replaceText; other controls: tap / drag them, or call the app through a backdoor',
  );
}

/**
 * How far up from a descendant a control's component may be when searching inside a container. Counts
 * every fiber (memo, forwardRef, context): @expo/ui's DateTimePicker is 6 above its native view (#29, #30).
 */
const INSIDE_DEPTH = 8;
/** How far the "what was searched" report looks (beyond the limits, to say why a component was not taken). */
const REPORT_DEPTH = 12;

interface Inside extends Control {
  /** Fibers between the control's component and the host it was found from. */
  depth: number;
}

/** The distinct controls rendered inside `node` whose component is at most `depth` fibers above a host (each reported once, at its nearest host, in render order). */
function controlsBelow(node: HostNode, depth = INSIDE_DEPTH): Inside[] {
  const byProps = new Map<Props, Inside>();
  const visit = (n: HostNode): void => {
    for (const c of n.children) {
      const found = c.findProps((p) => classify(p) !== null, depth);
      const kind = found === null ? null : classify(found.props);
      if (found !== null && kind !== null && isInside(found.props, node, depth)) {
        const seen = byProps.get(found.props);
        if (seen === undefined) byProps.set(found.props, { kind, props: found.props, name: found.name, node: c, depth: found.depth });
        else if (found.depth < seen.depth) seen.depth = found.depth;
        if (depth === INSIDE_DEPTH) continue;
      }
      visit(c);
    }
  };
  visit(node);
  return [...byProps.values()];
}

/** The component with `props` is below `container`: the container itself does not see it going up. */
function isInside(props: Props, container: HostNode, depth = INSIDE_DEPTH): boolean {
  return container.findProps((p) => p === props, depth) === null;
}

/** Props that decide a control's kind (plus testID), shown in the search report. */
const SHAPE_PROPS = ['testID', 'value', 'values', 'selectedValue', 'minimumValue', 'maximumValue', 'selection'];

function typeOf(v: unknown): string {
  if (v instanceof Date) return 'Date';
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

/** `{value: Date, onValueChange}`: the props that decide a control's kind, and the `on*` callbacks. */
function shape(p: Props): string {
  const parts: string[] = [];
  for (const k of SHAPE_PROPS) {
    if (!(k in p) || p[k] === undefined) continue;
    parts.push(k === 'testID' && typeof p[k] === 'string' ? `testID=${p[k]}` : `${k}: ${typeOf(p[k])}`);
  }
  for (const [k, v] of Object.entries(p)) if (isFn(v) && /^on[A-Z]/.test(k)) parts.push(k);
  return parts.length === 0 ? '' : ` {${parts.join(', ')}}`;
}

function hasShape(p: Props): boolean {
  return shape(p) !== '';
}

const MAX_REPORTED = 6;

/**
 * What `detectControl` looked at (issue #30): the components going up from the target, and the
 * control-shaped components inside it with the reason each was not taken. Tells whether to move the
 * testID, wrap the control, or use a backdoor.
 */
function searchReport(target: HostNode | CompositeNode, node: HostNode | null): string {
  const up: string[] = [];
  if (node !== null) up.push(`<${node.type}${node.testID !== undefined ? ` testID="${node.testID}"` : ''}>`);
  else up.push(`${(target as CompositeNode).name ?? 'component'}${shape(target.props)}`);
  target.findProps((p, name, depth) => {
    if (depth > 0 && (name !== null || hasShape(p))) up.push(`${name ?? '(host)'}${shape(p)}`);
    return false;
  }, REPORT_DEPTH);
  const upLine = `\n  searched up (${REPORT_DEPTH} levels): ${up.slice(0, MAX_REPORTED).join(' ← ')}${up.length > MAX_REPORTED ? ' ← …' : ''}`;
  if (node === null) return upLine;
  const inside = controlsBelow(node, REPORT_DEPTH);
  const near = inside.filter((c) => c.depth <= INSIDE_DEPTH);
  const lines = inside.slice(0, MAX_REPORTED).map((c) => {
    const why =
      c.depth > INSIDE_DEPTH
        ? `${c.depth} levels above its element (limit ${INSIDE_DEPTH})`
        : near.length > 1
          ? `one of ${near.length} controls inside; target one of them`
          : 'its element is nested too deep in the target';
    return `\n    ${c.name ?? '(anonymous)'}${shape(c.props)} (${c.kind}): not taken: ${why}`;
  });
  return (
    upLine +
    (inside.length === 0
      ? `\n  searched inside: no component with a value control's props below it`
      : `\n  searched inside (components up to ${INSIDE_DEPTH} levels above each element):${lines.join('')}${inside.length > MAX_REPORTED ? `\n    … ${inside.length - MAX_REPORTED} more` : ''}`)
  );
}

// ---- reading controls ----

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export interface SliderRange {
  min: number;
  max: number;
  /** 0 = continuous. */
  step: number;
}

/** @react-native-community/slider defaults: 0 … 1, continuous. */
export function sliderRange(p: Props): SliderRange {
  return { min: num(p['minimumValue'], 0), max: num(p['maximumValue'], 1), step: Math.max(0, num(p['step'], 0)) };
}

/** `value` within the range and on a step (tolerance for float steps). */
export function checkSliderValue(range: SliderRange, value: number, platform: string): void {
  const eps = 1e-9 * Math.max(1, Math.abs(range.max - range.min));
  if (value < range.min - eps || value > range.max + eps) {
    throw unsupported('setValue', `slider value ${value} is outside its range ${range.min} … ${range.max}`, platform);
  }
  if (range.step > 0) {
    const k = (value - range.min) / range.step;
    if (Math.abs(k - Math.round(k)) > 1e-6) {
      throw unsupported('setValue', `slider value ${value} is not on a step (minimumValue ${range.min}, step ${range.step})`, platform);
    }
  }
}

/** The value of a slider at `position` (0 … 1), on a step. */
export function sliderValueAt(range: SliderRange, position: number): number {
  const raw = range.min + position * (range.max - range.min);
  if (range.step <= 0) return raw;
  const snapped = range.min + Math.round((raw - range.min) / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, snapped));
}

/** React elements in `children` (arrays and fragments flattened), as plain props. */
function elementProps(children: unknown, out: Props[] = []): Props[] {
  if (Array.isArray(children)) {
    for (const c of children) elementProps(c, out);
  } else if (typeof children === 'object' && children !== null && 'props' in children) {
    const props = (children as { props: unknown }).props;
    if (typeof props === 'object' && props !== null) {
      const p = props as Props;
      if ('value' in p || 'label' in p) out.push(p);
      else elementProps(p['children'], out);
    }
  }
  return out;
}

/** Items of a Picker (its `Picker.Item` children) or of a `<select>` (its `<option>` hosts). */
export function pickerItems(control: Control): PickerItem[] {
  if (control.kind === 'select' && control.node !== null) {
    return control.node.children
      .filter((c) => c.type === 'option')
      .map((o) => ({ value: o.props['value'] ?? o.text, label: typeof o.props['label'] === 'string' ? o.props['label'] : o.text }));
  }
  return elementProps(control.props['children']).map((p) => ({
    value: p['value'] ?? p['label'],
    label: typeof p['label'] === 'string' ? p['label'] : String(p['value'] ?? ''),
  }));
}

/** Index of the item whose value (exactly, or as a string) or label is `value`. */
export function pickerIndex(control: Control, value: ControlValue, platform: string): number {
  const items = pickerItems(control);
  if (typeof value === 'object') throw unsupported('setValue', 'a picker takes an item value or label, not a date', platform);
  let i = items.findIndex((it) => it.value === value);
  if (i < 0) i = items.findIndex((it) => String(it.value) === String(value));
  if (i < 0) i = items.findIndex((it) => it.label === value);
  if (i < 0) {
    const list = items.map((it) => (it.label === String(it.value) ? JSON.stringify(it.value) : `${JSON.stringify(it.value)} (${it.label})`)).join(', ');
    throw unsupported('setValue', `the picker has no item ${JSON.stringify(value)}; items: ${list || 'none'}`, platform);
  }
  return i;
}

/** Index of the current selection of a picker / select, or -1. */
export function selectedPickerIndex(control: Control): number {
  const items = pickerItems(control);
  const sel = control.kind === 'select' ? control.props['value'] : control.props['selectedValue'];
  return items.findIndex((it) => it.value === sel);
}

export function segmentValues(control: Control): string[] {
  const v = control.props['values'];
  return Array.isArray(v) ? v.map(String) : [];
}

/** A segment by its value, or by its index when given a number that is not a value. */
export function segmentIndex(control: Control, value: ControlValue, platform: string): number {
  const values = segmentValues(control);
  if (typeof value === 'object' || typeof value === 'boolean') throw unsupported('setValue', 'a segmented control takes a segment value or index', platform);
  const byValue = values.indexOf(String(value));
  if (byValue >= 0) return byValue;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < values.length) return value;
  throw unsupported('setValue', `the segmented control has no segment ${JSON.stringify(value)}; segments: ${values.map((v) => JSON.stringify(v)).join(', ')}`, platform);
}

export function toDate(value: ControlValue, platform: string): Date {
  if (typeof value === 'object' && value !== null && typeof (value as DateValue).date === 'string') {
    const d = new Date((value as DateValue).date);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw unsupported('setValue', `a date picker takes a date (Date), got ${JSON.stringify(value)}`, platform);
}

/**
 * The Date a date / time picker ends up with for `value` (issue #18): a mode="time" picker keeps its day
 * and takes the hours and minutes, a mode="date" picker keeps its time, as the native dialogs do. Also
 * takes local strings ("2031-12-24", "20:15", "2031-12-24T20:15").
 */
export function pickerDate(props: Props, value: ControlValue, platform: string): Date {
  const input = typeof value === 'string' ? value : toDate(value, platform);
  const current = props['value'] instanceof Date ? props['value'] : new Date();
  try {
    return resolvePickerDate(current, input, pickerMode(props), pickerOffset(props));
  } catch (e) {
    throw unsupported('setValue', (e as Error).message, platform);
  }
}

/** A date within the picker's minimumDate / maximumDate. */
export function checkDate(props: Props, d: Date, platform: string): void {
  const min = props['minimumDate'];
  const max = props['maximumDate'];
  if (min instanceof Date && d.getTime() < min.getTime()) throw unsupported('setValue', `${d.toISOString()} is before the picker's minimumDate ${min.toISOString()}`, platform);
  if (max instanceof Date && d.getTime() > max.getTime()) throw unsupported('setValue', `${d.toISOString()} is after the picker's maximumDate ${max.toISOString()}`, platform);
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** The string an `<input type=...>` holds for `value` (local time for dates, like the browser shows). */
export function inputString(type: string, value: ControlValue, platform: string): string {
  if (!DATE_INPUTS.has(type)) {
    if (typeof value === 'object') throw unsupported('setValue', `an <input type="${type}"> takes a number or string`, platform);
    return String(value);
  }
  const d = typeof value === 'string' ? null : toDate(value, platform);
  if (d === null) return value as string; // already in the input's format
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  switch (type) {
    case 'date':
      return day;
    case 'time':
      return time;
    case 'month':
      return day.slice(0, 7);
    case 'datetime-local':
      return `${day}T${time}`;
    default: {
      // ISO week: the Thursday of d's week decides the year.
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
      const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
      return `${t.getUTCFullYear()}-W${pad(week)}`;
    }
  }
}

/** The current boolean of a switch / checkbox. */
export function switchState(control: Control): boolean {
  return control.dom === 'checkbox' && control.kind === 'checkbox' ? control.props['checked'] === true : control.props['value'] === true;
}

function isDisabled(p: Props): boolean {
  return p['disabled'] === true || p['enabled'] === false;
}

/** A disabled control: real input does nothing either, so modes leave it to jsSetValue (a no-op). */
export function isDisabledControl(control: Control): boolean {
  return isDisabled(control.props);
}

function call(p: Props, name: string, ...args: unknown[]): void {
  const f = p[name];
  if (isFn(f)) f(...args);
}

function domEvent(value: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const target = { value, ...extra };
  return { target, currentTarget: target, nativeEvent: { ...target }, type: 'change', persist() {}, preventDefault() {}, stopPropagation() {} };
}

/**
 * Set the control through its callbacks (js mode), with the arguments the real component passes.
 * A disabled control is left alone (like a user's attempt), and setting the current value sends no
 * event (native controls report changes only).
 */
export function jsSetValue(control: Control, value: ControlValue, platform: string): void {
  const p = control.props;
  if (isDisabled(p)) return;
  switch (control.kind) {
    case 'slider': {
      if (typeof value !== 'number') throw unsupported('setValue', `a slider takes a number, got ${JSON.stringify(value)}`, platform);
      checkSliderValue(sliderRange(p), value, platform);
      call(p, 'onSlidingStart', num(p['value'], sliderRange(p).min));
      call(p, 'onValueChange', value);
      call(p, 'onSlidingComplete', value);
      return;
    }
    case 'switch': {
      if (typeof value !== 'boolean') throw unsupported('setValue', `a switch takes true / false, got ${JSON.stringify(value)}`, platform);
      if (switchState(control) === value) return;
      // React Native's Switch calls onChange (native event) and onValueChange.
      call(p, 'onChange', { nativeEvent: { value } });
      call(p, 'onValueChange', value);
      return;
    }
    case 'picker': {
      const i = pickerIndex(control, value, platform);
      if (i === selectedPickerIndex(control)) return;
      const item = pickerItems(control)[i] as PickerItem;
      call(p, 'onValueChange', item.value, i);
      return;
    }
    case 'segmented': {
      const i = segmentIndex(control, value, platform);
      if (i === p['selectedIndex']) return;
      const v = segmentValues(control)[i];
      call(p, 'onChange', { nativeEvent: { value: v, selectedSegmentIndex: i } });
      call(p, 'onValueChange', v);
      return;
    }
    case 'date': {
      const d = pickerDate(p, value, platform);
      checkDate(p, d, platform);
      // datetimepicker: { type: 'set', nativeEvent: { timestamp, utcOffset } }; onValueChange wins over onChange.
      const event = { type: 'set', nativeEvent: { timestamp: d.getTime(), utcOffset: -d.getTimezoneOffset() } };
      if (isFn(p['onValueChange'])) call(p, 'onValueChange', event, d);
      else call(p, 'onChange', event, d);
      return;
    }
    case 'select': {
      const i = pickerIndex(control, value, platform);
      const item = pickerItems(control)[i] as PickerItem;
      call(p, 'onChange', domEvent(String(item.value), { selectedIndex: i }));
      return;
    }
    case 'input': {
      const s = inputString(String(p['type'] ?? 'text'), value, platform);
      call(p, 'onChange', domEvent(s));
      call(p, 'onInput', domEvent(s));
      return;
    }
    case 'checkbox': {
      if (typeof value !== 'boolean') throw unsupported('setValue', `a checkbox takes true / false, got ${JSON.stringify(value)}`, platform);
      if ((p['checked'] === true) === value) return;
      call(p, 'onChange', domEvent(value ? 'on' : '', { checked: value }));
      return;
    }
  }
}

// ---- accessibility actions ----

/** React Native's standard action names (others are custom actions with generated ids on Android). */
export const STANDARD_A11Y_ACTIONS: ReadonlySet<string> = new Set(['activate', 'longpress', 'increment', 'decrement', 'expand', 'collapse']);

export interface A11yTarget {
  /** The host that declares the actions (has a native view), or null when only a component declares them. */
  host: HostNode | null;
  actions: { name: string; label?: string }[];
  handler: Fn | null;
}

function actionsOf(p: Props): { name: string; label?: string }[] | null {
  const a = p['accessibilityActions'];
  if (!Array.isArray(a)) return null;
  return a
    .filter((x): x is { name: unknown; label?: unknown } => typeof x === 'object' && x !== null)
    .map((x) => ({ name: String(x.name), ...(typeof x.label === 'string' ? { label: x.label } : {}) }));
}

/** The element (or the nearest ancestor) declaring `accessibilityActions`, and its handler. */
export function a11yTarget(target: HostNode | CompositeNode): A11yTarget | null {
  if (isHostNode(target)) {
    for (let n: HostNode | null = target; n !== null; n = n.parent) {
      const actions = actionsOf(n.props);
      if (actions !== null) {
        const h = n.props['onAccessibilityAction'];
        return { host: n, actions, handler: isFn(h) ? h : (n.findHandler('onAccessibilityAction')?.fn ?? null) };
      }
    }
  }
  // react-native-web does not pass accessibilityActions to the DOM: read the component's props.
  const found = target.findProps((p) => actionsOf(p) !== null);
  if (found === null) return null;
  const h = found.props['onAccessibilityAction'];
  return { host: null, actions: actionsOf(found.props) ?? [], handler: isFn(h) ? h : null };
}

/** The declared action `name`, its index, and its index among the custom (non-standard) actions. */
export function declaredAction(t: A11yTarget, name: string, platform: string): { label: string; index: number; customIndex: number } {
  const index = t.actions.findIndex((a) => a.name === name);
  if (index < 0) {
    const names = t.actions.map((a) => a.name).join(', ');
    throw unsupported('accessibilityAction', `the element does not declare the accessibility action "${name}" (declared: ${names || 'none'})`, platform, 'add it to accessibilityActions; a screen reader can only perform declared actions');
  }
  const action = t.actions[index] as { name: string; label?: string };
  const customIndex = STANDARD_A11Y_ACTIONS.has(name) ? -1 : t.actions.slice(0, index).filter((a) => !STANDARD_A11Y_ACTIONS.has(a.name)).length;
  return { label: action.label ?? action.name, index, customIndex };
}

export function jsAccessibilityAction(t: A11yTarget, name: string, platform: string): void {
  declaredAction(t, name, platform);
  if (t.handler === null) throw unsupported('accessibilityAction', 'the element declares accessibilityActions but has no onAccessibilityAction', platform);
  t.handler({ nativeEvent: { actionName: name } });
}
