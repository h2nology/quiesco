import { describe, expect, it } from 'vitest';

import { evaluate, jsonEqual, readProp } from '../src/assertions';
import { node, tree } from './helpers/nodes';

const VP = { width: 400, height: 800 };
const offscreen = { x: 0, y: 900, width: 10, height: 10 };

const roots = () =>
  tree(
    { testID: 'title', type: 'RCTText', text: 'Todos' },
    { testID: 'row', type: 'RCTText', text: 'Buy milk' },
    { testID: 'row', type: 'RCTText', text: 'Walk dog', rect: offscreen },
    { testID: 'btn', props: { accessibilityState: { disabled: true } }, owner: { disabled: true, value: 'x' } },
  );

describe('evaluate()', () => {
  it('visible / notVisible consider any match', () => {
    expect(evaluate(roots(), { type: 'visible', matcher: { id: 'row' } }, VP).pass).toBe(true);
    expect(evaluate(roots(), { type: 'notVisible', matcher: { id: 'row' } }, VP)).toMatchObject({ pass: false, actual: '1 visible element(s)' });
    expect(evaluate(roots(), { type: 'notVisible', matcher: { text: 'Walk dog' } }, VP).pass).toBe(true);
    expect(evaluate(roots(), { type: 'visible', matcher: { id: 'nope' } }, VP)).toMatchObject({ pass: false, actual: 'no matching element' });
  });

  it('exists / notExists / count', () => {
    expect(evaluate(roots(), { type: 'exists', matcher: { text: 'Walk dog' } }, VP).pass).toBe(true);
    expect(evaluate(roots(), { type: 'notExists', matcher: { id: 'nope' } }, VP).pass).toBe(true);
    expect(evaluate(roots(), { type: 'count', matcher: { id: 'row' }, expected: 3 }, VP)).toMatchObject({ pass: false, expected: 3, actual: 2 });
  });

  it('text needs exactly one match and supports regex', () => {
    expect(evaluate(roots(), { type: 'text', matcher: { id: 'title' }, expected: 'Todos' }, VP).pass).toBe(true);
    expect(evaluate(roots(), { type: 'text', matcher: { id: 'title' }, expected: { regex: { source: '^todo', flags: 'i' } } }, VP).pass).toBe(true);
    expect(evaluate(roots(), { type: 'text', matcher: { id: 'row' }, expected: 'Buy milk' }, VP)).toMatchObject({ pass: false, actual: expect.stringMatching(/^2 matching elements/) });
    expect(evaluate(roots(), { type: 'text', matcher: { id: 'title' }, expected: 'X' }, VP)).toMatchObject({ pass: false, expected: 'X', actual: 'Todos' });
  });

  it('prop compares JSON values, falling back to the owning composite', () => {
    expect(evaluate(roots(), { type: 'prop', matcher: { id: 'btn' }, prop: 'disabled', expected: true }, VP).pass).toBe(true);
    expect(evaluate(roots(), { type: 'prop', matcher: { id: 'btn' }, prop: 'accessibilityState', expected: { disabled: true } }, VP).pass).toBe(true);
    expect(evaluate(roots(), { type: 'prop', matcher: { id: 'btn' }, prop: 'missing', expected: 1 }, VP)).toMatchObject({ pass: false, actual: null });
  });

  it('treats an unresolvable `within` as no match', () => {
    const ev = evaluate(roots(), { type: 'exists', matcher: { text: 'Todos', within: { id: 'row' } } }, VP);
    expect(ev).toMatchObject({ pass: false, actual: expect.stringMatching(/2 elements match/) });
    expect(evaluate(roots(), { type: 'notExists', matcher: { text: 'x', within: { id: 'none' } } }, VP).pass).toBe(true);
  });
});

describe('helpers', () => {
  it('readProp prefers host props', () => {
    expect(readProp(node({ props: { value: 'host' }, owner: { value: 'owner' } }), 'value')).toBe('host');
  });

  it('jsonEqual compares deeply', () => {
    expect(jsonEqual({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual([1], { 0: 1 })).toBe(false);
  });
});
