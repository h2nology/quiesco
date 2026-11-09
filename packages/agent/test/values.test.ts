/** Phase 6.3: value controls (detection, js mode), wheels, and the native / host performers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hostPerformer } from '../src/actions/host';
import { nativePerformer } from '../src/actions/native';
import type { NativeBridge } from '../src/actions/native';
import * as value from '../src/actions/value';
import type { WheelContext, WheelState } from '../src/actions/wheel';
import { classifyTurn, rowsFor, selectDate, selectRow } from '../src/actions/wheel';
import type { QuiescoError } from '../src/errors';
import type { CompositeNode } from '../src/fiber-adapter';
import type { Clock } from '../src/sync';
import { node, tree } from './helpers/nodes';

const clock: Clock = { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as number), now: () => Date.now() };

/** Settle a promise that waits on fake timers. */
async function run<T>(p: Promise<T>, ms = 60_000): Promise<T> {
  p.catch(() => {});
  await vi.advanceTimersByTimeAsync(ms);
  return p;
}

function errorOf(fn: () => unknown): QuiescoError {
  try {
    fn();
  } catch (e) {
    return e as QuiescoError;
  }
  throw new Error('expected an error');
}

const item = (label: string, v: unknown) => ({ props: { label, value: v } });

describe('detectControl', () => {
  it('finds the nearest component by the shape of its props', () => {
    const slider = node({ type: 'RCTSlider', props: { onChange: () => {} }, owner: { value: 3, minimumValue: 0, maximumValue: 10, onValueChange: () => {} } });
    expect(value.detectControl(slider, 'ios').kind).toBe('slider');
    expect(value.detectControl(node({ owner: { value: false, onValueChange: () => {} } }), 'ios').kind).toBe('switch');
    expect(value.detectControl(node({ owner: { selectedValue: 'a', onValueChange: () => {}, children: [item('A', 'a')] } }), 'ios').kind).toBe('picker');
    expect(value.detectControl(node({ owner: { values: ['S', 'M'], selectedIndex: 0, onChange: () => {} } }), 'ios').kind).toBe('segmented');
    expect(value.detectControl(node({ owner: { value: new Date(0), onChange: () => {} } }), 'ios').kind).toBe('date');
  });

  it('web: a <select> rendered by Picker is the picker; a bare <select> / date <input> is a DOM control', () => {
    const picker = node({ type: 'select', props: { onChange: () => {} }, owner: { selectedValue: 'a', onValueChange: () => {}, children: [item('A', 'a')] } });
    expect(value.detectControl(picker, 'web')).toMatchObject({ kind: 'picker', dom: 'select' });
    const bare = node({ type: 'select', props: { value: 'x', onChange: () => {} } });
    expect(value.detectControl(bare, 'web')).toMatchObject({ kind: 'select', dom: 'select' });
    // The app's own wrapper (value: Date, onChange(date)) around the input is not a datetimepicker.
    const input = node({ type: 'input', props: { type: 'date', onChange: () => {} }, ancestors: [{ props: { value: new Date(0), onChange: () => {} }, name: 'DateField' }] });
    expect(value.detectControl(input, 'web')).toMatchObject({ kind: 'input', dom: 'input' });
  });

  it('a container holding exactly one control uses that control (testID on a wrapper)', () => {
    const seg = { values: ['S', 'M', 'L'], selectedIndex: 0, onChange: () => {} };
    const wrapper = node({ testID: 'size', children: [{ owner: seg, children: [{ ancestors: [{ props: seg }] }] }] });
    const c = value.detectControl(wrapper, 'android');
    expect(c.kind).toBe('segmented');
    expect(c.node).toBe(wrapper.children[0]);
  });

  it('an unknown element fails with ACTION_NOT_SUPPORTED naming the callbacks it has', () => {
    const e = errorOf(() => value.detectControl(node({ props: { onLayout: () => {} }, owner: { onPress: () => {} } }), 'ios'));
    expect(e.errorName).toBe('ACTION_NOT_SUPPORTED');
    expect(e.message).toContain('onLayout, onPress');
  });

  it('a component without a host (Android DateTimePicker) is a control without a node', () => {
    const props = { value: new Date(0), onChange: () => {}, testID: 'when' };
    const composite: CompositeNode = { name: 'RNDateTimePickerAndroid', props, testID: 'when', rendersHost: false, findProps: (t) => (t(props) ? { props, name: null } : null) };
    expect(value.detectControl(composite, 'android')).toMatchObject({ kind: 'date', node: null });
  });
});

describe('jsSetValue', () => {
  it('slider: range and step are checked; callbacks in the native order', () => {
    const calls: string[] = [];
    const props = { value: 2, minimumValue: 0, maximumValue: 10, step: 2, onSlidingStart: (v: number) => calls.push(`start ${v}`), onValueChange: (v: number) => calls.push(`change ${v}`), onSlidingComplete: (v: number) => calls.push(`end ${v}`) };
    const c = value.detectControl(node({ owner: props }), 'ios');
    value.jsSetValue(c, 6, 'ios');
    expect(calls).toEqual(['start 2', 'change 6', 'end 6']);
    expect(errorOf(() => value.jsSetValue(c, 11, 'ios')).message).toContain('outside its range 0 … 10');
    expect(errorOf(() => value.jsSetValue(c, 5, 'ios')).message).toContain('not on a step');
    expect(errorOf(() => value.jsSetValue(c, true, 'ios')).message).toContain('takes a number');
  });

  it('switch: onChange + onValueChange, nothing when already set or disabled', () => {
    const onValueChange = vi.fn();
    const onChange = vi.fn();
    value.jsSetValue(value.detectControl(node({ owner: { value: false, onValueChange, onChange } }), 'ios'), true, 'ios');
    expect(onChange).toHaveBeenCalledWith({ nativeEvent: { value: true } });
    expect(onValueChange).toHaveBeenCalledWith(true);
    value.jsSetValue(value.detectControl(node({ owner: { value: true, onValueChange } }), 'ios'), true, 'ios');
    value.jsSetValue(value.detectControl(node({ owner: { value: false, disabled: true, onValueChange } }), 'ios'), true, 'ios');
    expect(onValueChange).toHaveBeenCalledOnce();
  });

  it('picker: by value, by value as a string, or by label; unknown items are listed', () => {
    const onValueChange = vi.fn();
    const c = value.detectControl(node({ owner: { selectedValue: 1, onValueChange, children: [item('One', 1), [item('Two', 2), item('Three', 'three')]] } }), 'ios');
    value.jsSetValue(c, 2, 'ios');
    value.jsSetValue(c, '2', 'ios');
    value.jsSetValue(c, 'Three', 'ios');
    value.jsSetValue(c, 1, 'ios'); // already selected
    expect(onValueChange.mock.calls).toEqual([
      [2, 1],
      [2, 1],
      ['three', 2],
    ]);
    expect(errorOf(() => value.jsSetValue(c, 'Four', 'ios')).message).toContain('items: 1 (One), 2 (Two), "three" (Three)');
  });

  it('segmented: by value or index, with the native event', () => {
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    const c = value.detectControl(node({ owner: { values: ['S', 'M', 'L'], selectedIndex: 0, onChange, onValueChange } }), 'ios');
    value.jsSetValue(c, 'L', 'ios');
    value.jsSetValue(c, 1, 'ios');
    expect(onChange.mock.calls).toEqual([[{ nativeEvent: { value: 'L', selectedSegmentIndex: 2 } }], [{ nativeEvent: { value: 'M', selectedSegmentIndex: 1 } }]]);
    expect(onValueChange.mock.calls).toEqual([['L'], ['M']]);
    expect(errorOf(() => value.jsSetValue(c, 'XL', 'ios')).message).toContain('segments: "S", "M", "L"');
  });

  it('date: a set event and the date; onValueChange wins; min / max dates are checked', () => {
    const onChange = vi.fn();
    const d = new Date(2027, 2, 8, 12);
    value.jsSetValue(value.detectControl(node({ owner: { value: new Date(), onChange } }), 'android'), { date: d.toISOString() }, 'android');
    expect(onChange).toHaveBeenCalledWith({ type: 'set', nativeEvent: { timestamp: d.getTime(), utcOffset: -d.getTimezoneOffset() } }, d);
    const onValueChange = vi.fn();
    value.jsSetValue(value.detectControl(node({ owner: { value: new Date(), onChange, onValueChange } }), 'ios'), { date: d.toISOString() }, 'ios');
    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    const bounded = value.detectControl(node({ owner: { value: new Date(), onChange, maximumDate: new Date(2026, 0, 1) } }), 'ios');
    expect(errorOf(() => value.jsSetValue(bounded, { date: d.toISOString() }, 'ios')).message).toContain('maximumDate');
    expect(errorOf(() => value.jsSetValue(bounded, 'tomorrow', 'ios')).message).toContain('takes a date');
  });

  it('DOM controls get change events with the value the browser would hold', () => {
    const onChange = vi.fn();
    value.jsSetValue(value.detectControl(node({ type: 'input', props: { type: 'date', onChange } }), 'web'), { date: new Date(2027, 2, 8, 12).toISOString() }, 'web');
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ target: { value: '2027-03-08' } });
    const select = node({ type: 'select', props: { value: 'a', onChange }, children: [{ type: 'option', props: { value: 'a' }, text: 'A' }, { type: 'option', props: { value: 'b' }, text: 'B' }] });
    value.jsSetValue(value.detectControl(select, 'web'), 'B', 'web');
    expect(onChange.mock.calls[1]?.[0]).toMatchObject({ target: { value: 'b', selectedIndex: 1 } });
  });

  it('inputString formats dates in local time per input type; sliderValueAt snaps to steps', () => {
    const d = { date: new Date(2027, 0, 4, 9, 5).toISOString() };
    expect(value.inputString('date', d, 'web')).toBe('2027-01-04');
    expect(value.inputString('time', d, 'web')).toBe('09:05');
    expect(value.inputString('datetime-local', d, 'web')).toBe('2027-01-04T09:05');
    expect(value.inputString('month', d, 'web')).toBe('2027-01');
    expect(value.inputString('week', d, 'web')).toBe('2027-W01');
    expect(value.inputString('number', 4, 'web')).toBe('4');
    expect(value.sliderValueAt({ min: 0, max: 100, step: 5 }, 0.33)).toBe(35);
    expect(value.sliderValueAt({ min: 0, max: 1, step: 0 }, 0.25)).toBe(0.25);
  });
});

describe('accessibility actions', () => {
  const actions = [{ name: 'increment' }, { name: 'magic' }, { name: 'activate' }, { name: 'reset', label: '重置' }];

  it('finds the declaring element (or ancestor) and the indexes the platforms need', () => {
    const onAccessibilityAction = vi.fn();
    const [stepper] = tree({ testID: 'stepper', props: { accessibilityActions: actions, onAccessibilityAction }, children: [{ type: 'RCTText', text: '5' }] });
    const t = value.a11yTarget(stepper!.children[0]!);
    expect(t?.host).toBe(stepper);
    expect(value.declaredAction(t!, 'reset', 'android')).toEqual({ label: '重置', index: 3, customIndex: 1 });
    expect(value.declaredAction(t!, 'increment', 'android')).toEqual({ label: 'increment', index: 0, customIndex: -1 });
    value.jsAccessibilityAction(t!, 'reset', 'web');
    expect(onAccessibilityAction).toHaveBeenCalledWith({ nativeEvent: { actionName: 'reset' } });
    expect(errorOf(() => value.jsAccessibilityAction(t!, 'archive', 'web')).message).toContain('declared: increment, magic, activate, reset');
  });

  it('web: actions declared on the component (react-native-web drops them from the DOM)', () => {
    const t = value.a11yTarget(node({ type: 'div', owner: { accessibilityActions: actions, onAccessibilityAction: () => {} } }));
    expect(t).toMatchObject({ host: null, actions });
  });
});

describe('wheels', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  /**
   * A simulated wheel: each drag moves the selection by (start − end) / rowHeight rows, provided the
   * finger goes down inside the wheel (y 100–316); the wheel reports `moving` for one read afterwards.
   */
  function fakeWheel(columns: { rows: number; selected: number }[], onTurn?: (c: number, rows: number) => void) {
    const box = { x: 0, y: 100, width: 300, height: 216 };
    const width = box.width / columns.length;
    let moving = false;
    const gestures: [{ x: number; y: number }, number][][] = [];
    const state = (): WheelState => ({
      found: true,
      ...box,
      moving,
      components: columns.map((c, i) => ({ selectedRow: c.selected, rows: c.rows, rowHeight: 32, title: null, x: i * width, width, y: box.y, height: box.height })),
    });
    const ctx: WheelContext = {
      read: async () => {
        const s = state();
        moving = false;
        return s;
      },
      gesture: async (path) => {
        gestures.push(path);
        const [start] = path[0]!;
        const [end] = path[path.length - 1]!;
        if (start.y < box.y || start.y > box.y + box.height) return; // missed the wheel
        const c = Math.floor(start.x / width);
        const rows = Math.round((start.y - end.y) / 32);
        const col = columns[c]!;
        col.selected = Math.max(0, Math.min(col.rows - 1, col.selected + rows));
        onTurn?.(c, rows);
        moving = true;
      },
      clock,
      deadline: Date.now() + 60_000,
      viewportHeight: 800,
      platform: 'native',
    };
    return { ctx, columns, gestures };
  }

  it('selectRow turns the column until the row is selected; every drag starts on the wheel', async () => {
    const { ctx, columns, gestures } = fakeWheel([{ rows: 40, selected: 2 }]);
    await run(selectRow(ctx, 0, 30));
    expect(columns[0]!.selected).toBe(30);
    expect(gestures.length).toBeGreaterThan(1); // 28 rows do not fit in one drag
    for (const g of gestures) expect(g[0]![0].y).toBeGreaterThanOrEqual(100);
    await run(selectRow(ctx, 0, 0));
    expect(columns[0]!.selected).toBe(0);
  });

  it('classifyTurn / rowsFor map a one-row turn to a calendar unit', () => {
    const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo, d, h, mi).getTime();
    expect(classifyTurn(at(2026, 0, 15), at(2027, 0, 15), 1)).toEqual({ unit: 'year', step: 1 });
    expect(classifyTurn(at(2026, 0, 31), at(2026, 1, 28), 1)).toEqual({ unit: 'month', step: 1 });
    expect(classifyTurn(at(2026, 0, 31), at(2026, 0, 1), 1)).toEqual({ unit: 'day', step: 1 });
    expect(classifyTurn(at(2026, 0, 31), at(2026, 1, 1), 2)).toEqual({ unit: 'date', step: 1 });
    expect(classifyTurn(at(2026, 0, 1, 9, 0), at(2026, 0, 1, 9, 15), 0)).toEqual({ unit: 'minute', step: 15 });
    expect(classifyTurn(at(2026, 0, 1, 9), at(2026, 0, 1, 21), 0)).toEqual({ unit: 'ampm', step: 1 });
    expect(classifyTurn(at(2026, 0, 1, 11), at(2026, 0, 1, 0), 0)).toEqual({ unit: 'hour', step: 1 });
    const f = (h: number, mi: number) => ({ y: 2026, mo: 0, d: 1, h, mi });
    expect(rowsFor('hour', 1, f(23, 0), f(1, 0), true)).toBe(-10);
    expect(rowsFor('hour', 1, f(23, 0), f(1, 0), false)).toBe(-22);
    expect(rowsFor('minute', 15, f(9, 0), f(9, 45), false)).toBe(3);
    expect(rowsFor('ampm', 1, f(9, 0), f(21, 0), true)).toBe(1);
  });

  it('selectDate probes each column (month / day / year in any order) and turns it to the target', async () => {
    // Columns: day, year, month (an order no locale table would guess). Rows: day 1–31, year 2000+, month 0–11.
    const date = { y: 2026, mo: 0, d: 15 };
    const columns = [
      { rows: 31, selected: date.d - 1 },
      { rows: 100, selected: date.y - 2000 },
      { rows: 12, selected: date.mo },
    ];
    const { ctx } = fakeWheel(columns, () => {
      date.d = (columns[0]!.selected % 31) + 1;
      date.y = 2000 + columns[1]!.selected;
      date.mo = columns[2]!.selected;
    });
    const read = ctx.read;
    ctx.read = async () => {
      // A wheel day beyond the month's end is clamped, like UIDatePicker.
      const last = new Date(date.y, date.mo + 1, 0).getDate();
      return { ...(await read()), datePickerMode: 1, date: new Date(date.y, date.mo, Math.min(date.d, last), 12).getTime() };
    };
    const s = await run(selectDate(ctx, new Date(2027, 2, 8, 12)));
    expect(new Date(s.date!).toDateString()).toBe(new Date(2027, 2, 8).toDateString());
  });
});

describe('native performer', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  function bridge(extra: Partial<NativeBridge> = {}): NativeBridge & { gestures: number[][] } {
    const gestures: number[][] = [];
    return {
      gestures,
      locate: vi.fn(async () => ({ found: true, x: 0, y: 0, width: 300, height: 40, windowHasFocus: true })),
      tap: vi.fn(async () => ({ handled: true })),
      swipe: vi.fn(async () => ({ handled: true })),
      typeText: vi.fn(async () => ({ text: '' })),
      gesture: vi.fn(async (_tag: number, path: number[]) => {
        gestures.push(path);
        return { handled: true };
      }),
      ...extra,
    };
  }

  const perform = (b: NativeBridge, roots: ReturnType<typeof tree>) =>
    nativePerformer({ bridge: b, clock, roots: () => roots, viewport: () => ({ width: 400, height: 800 }), action: 'setValue', matcher: { id: 'x' }, deadline: Date.now() + 30_000 });

  it('switch: a real tap only when the value must change; segmented: a tap on the segment', async () => {
    const b = bridge();
    const roots = tree({ testID: 'x', tag: 7, rect: { x: 0, y: 0, width: 300, height: 40 }, owner: { value: false, onValueChange: () => {} } });
    const p = perform(b, roots);
    await run(p.setValue(value.detectControl(roots[0]!, 'ios'), true));
    await run(p.setValue(value.detectControl(roots[0]!, 'ios'), false));
    expect(b.tap).toHaveBeenCalledOnce();
    const seg = tree({ testID: 'x', tag: 8, rect: { x: 0, y: 0, width: 300, height: 40 }, owner: { values: ['S', 'M', 'L'], selectedIndex: 0, onChange: () => {} } });
    await run(perform(b, seg).setValue(value.detectControl(seg[0]!, 'ios'), 'L'));
    expect(b.gestures[0]?.slice(0, 2)).toEqual([250, 20]);
  });

  it('picker without wheels (Android) and sliders use the callbacks', async () => {
    const onValueChange = vi.fn();
    const roots = tree({ testID: 'x', tag: 7, owner: { selectedValue: 'a', onValueChange, children: [item('A', 'a'), item('B', 'b')] } });
    await run(perform(bridge(), roots).setValue(value.detectControl(roots[0]!, 'android'), 'B'));
    expect(onValueChange).toHaveBeenCalledWith('b', 1);
  });

  it('adjustSlider drags the thumb, reads the value back and corrects for the touch slop', async () => {
    // A slider whose thumb follows the finger's travel minus 9 pt of slop; track 0–100 over x 50–250.
    let thumb = 90;
    const b = bridge({
      sliderInfo: vi.fn(async () => ({ found: true, minX: 50, maxX: 250, thumbX: thumb, y: 20, value: Math.round((thumb - 50) / 2), minimum: 0, maximum: 100 })),
      gesture: vi.fn(async (_tag: number, path: number[]) => {
        const from = path[0]!;
        const to = path[path.length - 3]!;
        const travel = to - from;
        thumb = Math.max(50, Math.min(250, thumb + travel - Math.sign(travel) * 9));
        return { handled: true };
      }),
    });
    const roots = tree({ testID: 'x', tag: 7, rect: { x: 50, y: 0, width: 200, height: 40 }, owner: { value: 20, minimumValue: 0, maximumValue: 100, step: 1, onValueChange: () => {} } });
    await run(perform(b, roots).adjustSlider(roots[0]!, value.detectControl(roots[0]!, 'ios'), 0.75));
    expect(Math.abs((thumb - 50) / 2 - 75)).toBeLessThanOrEqual(1);
  });

  it('adjustSlider / accessibilityAction need the Phase 6.3 native module', async () => {
    const roots = tree({ testID: 'x', tag: 7, owner: { value: 1, minimumValue: 0, onValueChange: () => {} }, props: { accessibilityActions: [{ name: 'increment' }], onAccessibilityAction: () => {} } });
    const p = perform(bridge(), roots);
    await expect(run(p.adjustSlider(roots[0]!, value.detectControl(roots[0]!, 'ios'), 0.5))).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', message: expect.stringContaining('sliderInfo') });
    await expect(run(p.accessibilityAction(value.a11yTarget(roots[0]!)!, 'increment'))).rejects.toMatchObject({ message: expect.stringContaining('accessibilityAction') });
  });

  it('accessibilityAction goes to the native view with its label and indexes', async () => {
    const accessibilityAction = vi.fn(async () => ({ performed: false, via: 'performAccessibilityAction' }));
    const roots = tree({ testID: 'x', tag: 9, props: { accessibilityActions: [{ name: 'increment' }, { name: 'reset', label: 'Reset' }], onAccessibilityAction: () => {} } });
    await run(perform(bridge({ accessibilityAction }), roots).accessibilityAction(value.a11yTarget(roots[0]!)!, 'reset'));
    expect(accessibilityAction).toHaveBeenCalledWith(9, 'reset', 'Reset', 1, 0);
  });
});

describe('host performer (web)', () => {
  const perform = (roots: ReturnType<typeof tree>) => hostPerformer({ clock, roots: () => roots, viewport: () => ({ width: 400, height: 800 }), matcher: { id: 'x' }, deadline: 0 });

  it('select → selectOption, date input → fill, switch → click when it must change', async () => {
    const picker = tree({ type: 'select', rect: { x: 0, y: 0, width: 100, height: 20 }, owner: { selectedValue: 1, onValueChange: () => {}, children: [item('One', 1), item('Two', 2)] } });
    await expect(perform(picker).setValue(value.detectControl(picker[0]!, 'web'), 'Two')).resolves.toEqual({ kind: 'select', x: 50, y: 10, value: '2' });
    const date = tree({ type: 'input', rect: { x: 0, y: 0, width: 100, height: 20 }, props: { type: 'date', onChange: () => {} } });
    await expect(perform(date).setValue(value.detectControl(date[0]!, 'web'), { date: new Date(2027, 2, 8, 12).toISOString() })).resolves.toEqual({ kind: 'fill', x: 50, y: 10, value: '2027-03-08' });
    const sw = tree({ type: 'div', rect: { x: 0, y: 0, width: 40, height: 20 }, owner: { value: false, onValueChange: () => {} } });
    await expect(perform(sw).setValue(value.detectControl(sw[0]!, 'web'), true)).resolves.toMatchObject({ kind: 'tap', x: 20, y: 10 });
    await expect(perform(sw).setValue(value.detectControl(sw[0]!, 'web'), false)).resolves.toBeUndefined();
  });

  it('adjustSlider drags the thumb (the square child) along the track inset by half a thumb', async () => {
    const slider = tree({ rect: { x: 0, y: 0, width: 220, height: 40 }, owner: { value: 0, minimumValue: 0, maximumValue: 100, onValueChange: () => {} }, children: [{ rect: { x: 0, y: 10, width: 20, height: 20 } }] });
    await expect(perform(slider).adjustSlider(slider[0]!, value.detectControl(slider[0]!, 'web'), 0.5)).resolves.toEqual({ kind: 'drag', from: { x: 10, y: 20 }, to: { x: 110, y: 20 }, durationMs: 300, holdMs: 0 });
  });
});
