import { describe, expect, it } from 'vitest';

import { evaluate } from '../src/assertions';
import { describeMatcher, findAll, isVisible, summarize, visibleRatio } from '../src/query';
import { checkedState, elementValue, isEnabled, semanticType } from '../src/query/semantic';
import { node, tree } from './helpers/nodes';

const VIEWPORT = { width: 400, height: 800 };

describe('semanticType()', () => {
  it.each([
    ['RCTText', 'text'],
    ['RCTVirtualText', 'text'],
    ['RCTSinglelineTextInputView', 'input'],
    ['RCTMultilineTextInputView', 'input'],
    ['AndroidTextInput', 'input'],
    ['RCTImageView', 'image'],
    ['Switch', 'switch'],
    ['AndroidSwitch', 'switch'],
    ['ActivityIndicatorView', 'progress'],
    ['AndroidProgressBar', 'progress'],
    ['RCTScrollView', 'scroll'],
    ['AndroidHorizontalScrollView', 'scroll'],
    ['RNCSlider', 'slider'],
    ['RNCPicker', 'picker'],
    ['textarea', 'input'],
    ['img', 'image'],
    ['select', 'picker'],
    ['a', 'link'],
    ['h2', 'header'],
  ])('host %s → %s', (type, expected) => {
    expect(semanticType(node({ type }))).toBe(expected);
  });

  it('maps DOM inputs by their type attribute', () => {
    expect(semanticType(node({ type: 'input', props: { type: 'text' } }))).toBe('input');
    expect(semanticType(node({ type: 'input' }))).toBe('input');
    expect(semanticType(node({ type: 'input', props: { type: 'checkbox' } }))).toBe('checkbox');
    expect(semanticType(node({ type: 'input', props: { type: 'range' } }))).toBe('slider');
  });

  it('prefers the accessibility role (case-insensitive)', () => {
    expect(semanticType(node({ type: 'RCTView', role: 'button' }))).toBe('button');
    expect(semanticType(node({ type: 'RCTText', role: 'link' }))).toBe('link');
    expect(semanticType(node({ type: 'div', role: 'Switch' }))).toBe('switch');
    expect(semanticType(node({ type: 'RCTView', role: 'adjustable' }))).toBe('slider');
    expect(semanticType(node({ type: 'RCTView', role: 'none' }))).toBeUndefined();
  });

  it('a scroll host rendered by a virtualized list (renderItem) is a list, minification-proof', () => {
    expect(semanticType(node({ type: 'RCTScrollView', owner: { renderItem: () => null, data: [] } }))).toBe('list');
    expect(semanticType(node({ type: 'div', clips: true, owner: { renderItem: () => null } }))).toBe('list');
    expect(semanticType(node({ type: 'RCTScrollView' }))).toBe('scroll');
  });

  it('falls back to named owning components, then to an onPress handler', () => {
    expect(semanticType(node({ type: 'RCTView', ownerNames: ['View', 'Pressable'] }))).toBe('button');
    expect(semanticType(node({ type: 'div', ownerNames: ['Text'] }))).toBe('text');
    expect(semanticType(node({ type: 'div', ownerNames: ['View', 'TodoItem'] }))).toBeUndefined();
    expect(semanticType(node({ type: 'RCTView', owner: { onPress: () => {} } }))).toBe('button');
    expect(semanticType(node({ type: 'RCTView' }))).toBeUndefined();
  });
});

describe('element state', () => {
  it('enabled: disabled / accessibilityState / aria-disabled / editable=false, also from ancestors', () => {
    expect(isEnabled(node({}))).toBe(true);
    expect(isEnabled(node({ owner: { disabled: true } }))).toBe(false);
    expect(isEnabled(node({ props: { accessibilityState: { disabled: true } } }))).toBe(false);
    expect(isEnabled(node({ props: { 'aria-disabled': 'true' } }))).toBe(false);
    expect(isEnabled(node({ type: 'AndroidTextInput', props: { editable: false } }))).toBe(false);
    const button = node({ owner: { disabled: true }, children: [{ type: 'RCTText', text: 'Save' }] });
    expect(isEnabled(button.children[0]!)).toBe(false);
  });

  it('checked: accessibility state first, then the switch / checkbox value', () => {
    expect(checkedState(node({ props: { accessibilityState: { checked: true } } }))).toBe(true);
    expect(checkedState(node({ props: { 'aria-checked': 'mixed' } }))).toBe('mixed');
    expect(checkedState(node({ type: 'AndroidSwitch', props: { value: false } }))).toBe(false);
    expect(checkedState(node({ type: 'input', props: { type: 'checkbox', checked: true } }))).toBe(true);
    expect(checkedState(node({ type: 'RCTView', props: { value: true } }))).toBeUndefined();
  });

  it('value: input text, switch state, slider / picker value, accessibilityValue', () => {
    expect(elementValue(node({ type: 'AndroidTextInput', inputValue: 'hello' }))).toBe('hello');
    expect(elementValue(node({ type: 'Switch', props: { value: true } }))).toBe(true);
    expect(elementValue(node({ type: 'RNCSlider', props: { value: 0.25 } }))).toBe(0.25);
    expect(elementValue(node({ type: 'RNCPicker', owner: { selectedValue: 'ja' } }))).toBe('ja');
    expect(elementValue(node({ props: { accessibilityValue: { min: 0, max: 10, now: 3 } } }))).toBe(3);
    expect(elementValue(node({ props: { accessibilityValue: { text: 'three' } } }))).toBe('three');
    expect(elementValue(node({ props: { 'aria-valuenow': 7 } }))).toBe(7);
    expect(elementValue(node({}))).toBeUndefined();
  });

  it('summarize() reports semantic type, state and visible ratio', () => {
    const s = summarize(node({ type: 'Switch', testID: 'wifi', props: { value: true }, focused: false }), VIEWPORT);
    expect(s).toMatchObject({ semanticType: 'switch', checked: true, value: true, enabled: true, focused: false, visible: true, visibleRatio: 1 });
  });
});

describe('visibility with clipping', () => {
  // A 100px tall scroll view at y=100; rows are 50px tall.
  const list = () =>
    node({
      type: 'RCTScrollView',
      clips: true,
      rect: { x: 0, y: 100, width: 400, height: 100 },
      children: [
        { testID: 'r0', rect: { x: 0, y: 100, width: 400, height: 50 } },
        { testID: 'r1', rect: { x: 0, y: 175, width: 400, height: 50 } }, // half inside
        { testID: 'r2', rect: { x: 0, y: 300, width: 400, height: 50 } }, // inside the window, outside the scroll view
      ],
    });

  it('an element scrolled out of its scroll view is not visible even though it is in the window', () => {
    const [r0, r1, r2] = list().children;
    expect(isVisible(r0!, VIEWPORT)).toBe(true);
    expect(visibleRatio(r1!, VIEWPORT)).toBeCloseTo(0.5);
    expect(isVisible(r2!, VIEWPORT)).toBe(false);
  });

  it('non-clipping ancestors and unmeasurable clipping ancestors do not clip', () => {
    const plain = node({ rect: { x: 0, y: 0, width: 10, height: 10 }, children: [{ rect: { x: 0, y: 300, width: 10, height: 10 } }] });
    expect(isVisible(plain.children[0]!, VIEWPORT)).toBe(true);
    const unmeasured = node({ clips: true, rect: null, children: [{ rect: { x: 0, y: 300, width: 10, height: 10 } }] });
    expect(isVisible(unmeasured.children[0]!, VIEWPORT)).toBe(true);
  });

  it('the window clips too; hidden-by-style is 0', () => {
    expect(visibleRatio(node({ rect: { x: 300, y: 0, width: 200, height: 10 } }), VIEWPORT)).toBeCloseTo(0.5);
    expect(visibleRatio(node({ hidden: true }), VIEWPORT)).toBe(0);
  });

  it('visible { ratio } and notVisible { ratio }', () => {
    const roots = [list()];
    const r1 = { id: 'r1' };
    expect(evaluate(roots, { type: 'visible', matcher: r1 }, VIEWPORT).pass).toBe(true);
    expect(evaluate(roots, { type: 'visible', matcher: r1, ratio: 0.75 }, VIEWPORT)).toMatchObject({ pass: false, actual: '50% visible' });
    expect(evaluate(roots, { type: 'notVisible', matcher: r1, ratio: 0.75 }, VIEWPORT).pass).toBe(true);
    expect(evaluate(roots, { type: 'visible', matcher: { id: 'r0' }, ratio: 1 }, VIEWPORT).pass).toBe(true);
  });
});

describe('matcher: id regex, type, has, not', () => {
  const app = () =>
    tree({
      testID: 'screen',
      children: [
        { testID: 'todo-1', role: 'button', children: [{ type: 'RCTText', text: 'Buy milk' }, { type: 'AndroidSwitch', testID: 'done-1', props: { value: true } }] },
        { testID: 'todo-2', role: 'button', children: [{ type: 'RCTText', text: 'Walk dog' }, { type: 'AndroidSwitch', testID: 'done-2', props: { value: false } }] },
        { testID: 'title', type: 'AndroidTextInput', inputValue: '' },
      ],
    });

  it('id accepts a regular expression', () => {
    expect(findAll(app(), { id: { regex: { source: '^todo-\\d$', flags: '' } } }).map((n) => n.testID)).toEqual(['todo-1', 'todo-2']);
  });

  it('type matches semantic type, host type and owner component names', () => {
    expect(findAll(app(), { type: 'switch' }).map((n) => n.testID)).toEqual(['done-1', 'done-2']);
    expect(findAll(app(), { type: 'AndroidTextInput' }).map((n) => n.testID)).toEqual(['title']);
    expect(findAll(tree({ testID: 'c', ownerNames: ['TodoCard'] }), { type: 'TodoCard' })).toHaveLength(1);
  });

  it('has = some descendant matches; not excludes', () => {
    expect(findAll(app(), { type: 'button', has: { text: 'Walk dog' } }).map((n) => n.testID)).toEqual(['todo-2']);
    expect(findAll(app(), { type: 'button', not: { id: 'todo-1' } }).map((n) => n.testID)).toEqual(['todo-2']);
    expect(findAll(app(), { type: 'switch', within: { type: 'button', has: { text: 'Buy milk' } } }).map((n) => n.testID)).toEqual(['done-1']);
  });

  it('describeMatcher shows the new fields', () => {
    expect(describeMatcher({ id: { regex: { source: '^a', flags: 'i' } }, type: 'button', has: { text: 'x' }, not: { id: 'y' } })).toBe(
      '{ id: /^a/i, type: "button", has: { text: "x" }, not: { id: "y" } }',
    );
  });
});

describe('state assertions', () => {
  const roots = () =>
    tree(
      { testID: 'email', type: 'AndroidTextInput', inputValue: 'a@b.c', focused: true, label: 'Email' },
      { testID: 'save', role: 'button', owner: { disabled: true } },
      { testID: 'wifi', type: 'AndroidSwitch', props: { value: false } },
    );

  it('focused / enabled / checked and their opposites', () => {
    const r = roots();
    expect(evaluate(r, { type: 'focused', matcher: { id: 'email' } }, VIEWPORT).pass).toBe(true);
    expect(evaluate(r, { type: 'notFocused', matcher: { id: 'save' } }, VIEWPORT).pass).toBe(true);
    expect(evaluate(r, { type: 'disabled', matcher: { id: 'save' } }, VIEWPORT).pass).toBe(true);
    expect(evaluate(r, { type: 'enabled', matcher: { id: 'save' } }, VIEWPORT)).toMatchObject({ pass: false, expected: 'enabled', actual: 'disabled' });
    expect(evaluate(r, { type: 'notChecked', matcher: { id: 'wifi' } }, VIEWPORT).pass).toBe(true);
    expect(evaluate(r, { type: 'checked', matcher: { id: 'wifi' } }, VIEWPORT).pass).toBe(false);
  });

  it('value and label, with regex and negation', () => {
    const r = roots();
    expect(evaluate(r, { type: 'value', matcher: { id: 'email' }, expected: 'a@b.c' }, VIEWPORT).pass).toBe(true);
    expect(evaluate(r, { type: 'value', matcher: { id: 'email' }, expected: { regex: { source: '@b\\.', flags: '' } } }, VIEWPORT).pass).toBe(true);
    expect(evaluate(r, { type: 'value', matcher: { id: 'wifi' }, expected: false }, VIEWPORT).pass).toBe(true);
    expect(evaluate(r, { type: 'value', matcher: { id: 'email' }, expected: 'x', not: true }, VIEWPORT).pass).toBe(true);
    expect(evaluate(r, { type: 'label', matcher: { id: 'email' }, expected: 'Email' }, VIEWPORT).pass).toBe(true);
  });

  it('negated single-element assertions still need exactly one match', () => {
    expect(evaluate(roots(), { type: 'text', matcher: { id: 'missing' }, expected: 'x', not: true }, VIEWPORT).pass).toBe(false);
    expect(evaluate(roots(), { type: 'count', matcher: { id: 'missing' }, expected: 1, not: true }, VIEWPORT).pass).toBe(true);
  });
});

describe('widgets made of several hosts (react-native-web Switch)', () => {
  // RNW: <div data-testid ...> (typed via the Switch displayName) > track div, thumb div, <input role="switch" checked disabled>
  const webSwitch = (checked: boolean, disabled: boolean) =>
    tree({
      testID: 'screen',
      children: [
        {
          type: 'div',
          testID: 'wifi',
          ownerNames: ['View', 'Switch'],
          children: [
            { type: 'div', ownerNames: ['View'] },
            { type: 'div', ownerNames: ['View'] },
            { type: 'input', role: 'switch', label: 'Wi-Fi', withParent: true, props: { type: 'checkbox', checked, disabled }, focused: true },
          ],
        },
      ],
    });

  it('counts the widget once, by its root', () => {
    expect(findAll(webSwitch(false, false), { type: 'switch' }).map((n) => n.testID)).toEqual(['wifi']);
  });

  it('the root takes the label of its part (RNW puts aria-label on the inner input)', () => {
    expect(findAll(webSwitch(false, false), { type: 'switch', label: 'Wi-Fi' }).map((n) => n.testID)).toEqual(['wifi']);
    expect(summarize(findAll(webSwitch(false, false), { id: 'wifi' })[0]!, VIEWPORT).label).toBe('Wi-Fi');
  });

  it('the root reads checked / value / enabled / focus from its part', () => {
    const [root] = findAll(webSwitch(true, true), { id: 'wifi' });
    expect(summarize(root!, VIEWPORT)).toMatchObject({ semanticType: 'switch', checked: true, value: true, enabled: false, focused: true });
    const [off] = findAll(webSwitch(false, false), { id: 'wifi' });
    expect(summarize(off!, VIEWPORT)).toMatchObject({ checked: false, value: false, enabled: true });
  });

  it('a nested widget of the same kind that is rendered by its own component is not a part', () => {
    // e.g. a horizontal list inside a list row: the inner list has components between it and its parent.
    const roots = tree({ type: 'RCTScrollView', owner: { renderItem: () => null }, children: [{ type: 'RCTScrollView', owner: { renderItem: () => null } }] });
    expect(findAll(roots, { type: 'list' })).toHaveLength(2);
  });
});

describe('notChecked is strict', () => {
  it('fails on elements without any checked state', () => {
    const roots = tree({ testID: 'plain' }, { testID: 'off', type: 'AndroidSwitch', props: { value: false } });
    expect(evaluate(roots, { type: 'notChecked', matcher: { id: 'plain' } }, VIEWPORT).pass).toBe(false);
    expect(evaluate(roots, { type: 'notChecked', matcher: { id: 'off' } }, VIEWPORT).pass).toBe(true);
  });
});
