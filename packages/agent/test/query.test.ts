import { describe, expect, it } from 'vitest';

import { QuiescoError } from '../src/errors';
import { describeMatcher, findAll, getTree, isVisible, resolveOne, serializableProps, structureLines, summarize } from '../src/query';
import { node, tree } from './helpers/nodes';

const VIEWPORT = { width: 400, height: 800 };

const app = () =>
  tree({
    testID: 'screen',
    children: [
      { testID: 'form', children: [
        { testID: 'email', type: 'RCTTextInput', label: 'Email', props: { value: 'a@b.c', editable: true, onChangeText: () => {} } },
        { testID: 'submit', role: 'button', label: 'Log in', children: [{ type: 'RCTText', text: 'Login' }] },
      ] },
      { testID: 'list', children: [
        { testID: 'row', children: [{ type: 'RCTText', text: 'Buy milk' }] },
        { testID: 'row', children: [{ type: 'RCTText', text: 'Walk dog' }] },
      ] },
    ],
  });

describe('Matcher', () => {
  it('matches by id, label and role', () => {
    const roots = app();
    expect(findAll(roots, { id: 'email' }).map((n) => n.type)).toEqual(['RCTTextInput']);
    expect(findAll(roots, { label: 'Log in' }).map((n) => n.testID)).toEqual(['submit']);
    expect(findAll(roots, { role: 'button' }).map((n) => n.testID)).toEqual(['submit']);
    expect(findAll(roots, { id: 'nope' })).toEqual([]);
  });

  it('matches text exactly or by regex, returning only the deepest matching node', () => {
    const roots = app();
    expect(findAll(roots, { text: 'Login' }).map((n) => n.type)).toEqual(['RCTText']);
    expect(findAll(roots, { text: 'Log' })).toEqual([]);
    expect(findAll(roots, { text: { regex: { source: '^(buy|walk)', flags: 'i' } } }).map((n) => n.text)).toEqual(['Buy milk', 'Walk dog']);
    // combined with id, the container itself is the deepest node satisfying the whole matcher
    expect(findAll(roots, { id: 'submit', text: 'Login' }).map((n) => n.testID)).toEqual(['submit']);
  });

  it('keeps a regex with the global flag stateless across nodes', () => {
    const roots = tree({ text: 'a' }, { text: 'a' });
    expect(findAll(roots, { text: { regex: { source: 'a', flags: 'g' } } })).toHaveLength(2);
  });

  it('restricts to descendants with within, and picks with index', () => {
    const roots = app();
    expect(findAll(roots, { text: 'Walk dog', within: { id: 'form' } })).toEqual([]);
    expect(findAll(roots, { id: 'row', index: 1 }).map((n) => n.text)).toEqual(['Walk dog']);
    expect(findAll(roots, { id: 'row', index: 5 })).toEqual([]);
    expect(findAll(roots, { text: 'Walk dog', within: { id: 'row', index: 1 } })).toHaveLength(1);
  });

  it('within must resolve to exactly one element', () => {
    const roots = app();
    expect(() => findAll(roots, { text: 'Walk dog', within: { id: 'row' } })).toThrow(/2 elements match \{ id: "row" \}/);
    expect(() => findAll(roots, { text: 'x', within: { id: 'missing' } })).toThrow(QuiescoError);
  });

  it('resolveOne throws ELEMENT_NOT_FOUND / MULTIPLE_MATCHES with candidates', () => {
    const roots = app();
    expect(resolveOne(roots, { id: 'submit' }).testID).toBe('submit');
    try {
      resolveOne(roots, { id: 'row' }, (n) => summarize(n, VIEWPORT));
      expect.unreachable();
    } catch (e) {
      const err = e as QuiescoError<'MULTIPLE_MATCHES'>;
      expect(err.toJSON()).toMatchObject({ code: 1002, data: { name: 'MULTIPLE_MATCHES', matcher: { id: 'row' } } });
      expect(err.data.matches.map((m) => m.text)).toEqual(['Buy milk', 'Walk dog']);
    }
    expect(() => resolveOne(roots, { id: 'nope' })).toThrow(expect.objectContaining({ errorName: 'ELEMENT_NOT_FOUND' }));
  });

  it('describes matchers readably', () => {
    expect(describeMatcher({ id: 'a', text: { regex: { source: 'x', flags: 'i' } }, within: { role: 'list' }, index: 0 })).toBe(
      '{ id: "a", text: /x/i, within: { role: "list" }, index: 0 }',
    );
  });
});

describe('visibility', () => {
  it('requires a non-empty rect inside the viewport', () => {
    const [n] = tree({});
    expect(isVisible(n!, VIEWPORT, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    expect(isVisible(n!, VIEWPORT, { x: 390, y: 790, width: 50, height: 50 })).toBe(true); // partially on screen
    expect(isVisible(n!, VIEWPORT, { x: 0, y: 800, width: 10, height: 10 })).toBe(false); // just below
    expect(isVisible(n!, VIEWPORT, { x: -20, y: 0, width: 20, height: 10 })).toBe(false); // just left
    expect(isVisible(n!, VIEWPORT, { x: 0, y: 0, width: 0, height: 10 })).toBe(false);
    expect(isVisible(n!, VIEWPORT, null)).toBe(false);
    expect(isVisible(n!, null, { x: 5000, y: 0, width: 10, height: 10 })).toBe(true); // viewport unknown
  });

  it('is false when the node or any ancestor is hidden by style', () => {
    const [root] = tree({ hidden: true, children: [{ children: [{ testID: 'leaf' }] }] });
    const leaf = root!.children[0]!.children[0]!;
    expect(isVisible(leaf, VIEWPORT)).toBe(false);
  });
});

describe('serialization', () => {
  it('summarize() reports props without functions, elements or children', () => {
    const [email] = findAll(app(), { id: 'email' });
    const s = summarize(email!, VIEWPORT);
    expect(s).toMatchObject({ type: 'RCTTextInput', testID: 'email', label: 'Email', visible: true });
    expect(s.props).toEqual({ value: 'a@b.c', editable: true });
  });

  it('serializableProps() drops cycles, React elements and non-finite numbers', () => {
    const cyc: Record<string, unknown> = { a: 1 };
    cyc['self'] = cyc;
    expect(
      serializableProps({ cyc, el: { $$typeof: Symbol.for('react.element') }, n: Number.NaN, s: Symbol('x'), arr: [1, () => 1], style: { flex: 1 } }),
    ).toEqual({ cyc: { a: 1 }, n: null, arr: [1, null] });
  });

  it('getTree() exports type / testID / own text / role / semantic type / rounded rect', () => {
    const roots = tree({ testID: 'a', rect: { x: 0.4, y: 1.6, width: 10.5, height: 3 }, children: [{ type: 'RCTText', text: 'hi', rect: null }] });
    expect(getTree(roots)).toEqual({
      type: 'RCTView',
      testID: 'a',
      rect: { x: 0, y: 2, width: 11, height: 3 },
      children: [{ type: 'RCTText', text: 'hi', semanticType: 'text', children: [] }],
    });
    expect(getTree([])).toBeNull();
    expect(getTree(tree({}, {}))?.type).toBe('root');
  });

  it('structureLines() leaves out skipped elements with their subtrees', () => {
    const spinning = node({ children: [{ text: 'glow', rect: { x: 0, y: 0, width: 228, height: 228 } }] });
    const page = node({ children: [] });
    const all = structureLines([page, spinning]);
    const skipped = structureLines([page, spinning], new Set([spinning]));
    expect(all).toHaveLength(3);
    expect(skipped).toEqual(structureLines([page]));
  });

  it('structureLines() changes with text, rect (rounded) and structure, not with sub-pixel moves', () => {
    const base = node({ children: [{ text: 'a', rect: { x: 0, y: 0, width: 10, height: 10 } }] });
    const h = structureLines([base]);
    expect(h).toHaveLength(2);
    expect(h[1]).toMatch(/"a" @0,0 10x10 children=0$/);
    expect(structureLines([node({ children: [{ text: 'a', rect: { x: 0.2, y: 0, width: 10, height: 10 } }] })])).toEqual(h);
    expect(structureLines([node({ children: [{ text: 'b', rect: { x: 0, y: 0, width: 10, height: 10 } }] })])).not.toEqual(h);
    expect(structureLines([node({ children: [{ text: 'a', rect: { x: 5, y: 0, width: 10, height: 10 } }] })])).not.toEqual(h);
    expect(structureLines([node({ children: [{ text: 'a', rect: { x: 0, y: 0, width: 10, height: 10 } }, {}] })])).not.toEqual(h);
  });
});
