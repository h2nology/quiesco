import { describe, expect, it, vi } from 'vitest';

import { FiberAdapter } from '../src/fiber-adapter';
import { WorkTag } from '../src/fiber-adapter/fiber';
import { HOOK_KEY } from '../src/fiber-adapter/hook';
import { composite, fakeScheduler, hookOf, host, makeRoot, renderWith, special, text } from './helpers/fake-fiber';

function setup(target: Record<string, unknown> = {}, extra: Partial<ConstructorParameters<typeof FiberAdapter>[0]> = {}) {
  const sched = fakeScheduler();
  const adapter = new FiberAdapter({
    target,
    loadScheduler: () => sched.mod,
    platformDeps: {
      getPublicInstance: () => (fiber) => fiber.stateNode,
      viewport: () => ({ width: 400, height: 800 }),
    },
    ...extra,
  });
  adapter.install();
  return { adapter, target, sched };
}

describe('DevTools hook', () => {
  it('installs a minimal hook when none exists and records roots on commit', () => {
    const { adapter, target } = setup();
    const hook = hookOf(target);
    expect(hook.supportsFiber).toBe(true);
    renderWith(target, makeRoot(host('RCTView', { testID: 'a' })));
    const d = adapter.diagnostics();
    expect(d.hookSource).toBe('installed');
    expect(d.rootCount).toBe(1);
    expect(d.renderers[0]).toMatchObject({ packageName: 'react-native-renderer', kind: 'native', supported: true });
    expect(d.problems).toEqual([]);
  });

  it('wraps an existing hook and still calls the original methods', () => {
    const inject = vi.fn(() => 7);
    const onCommitFiberRoot = vi.fn();
    const original = { supportsFiber: true, renderers: new Map(), inject, onCommitFiberRoot, onScheduleFiberRoot: vi.fn() };
    const { adapter, target } = setup({ [HOOK_KEY]: original });
    expect(target[HOOK_KEY]).toBe(original);
    const root = makeRoot(host('RCTView'));
    const id = renderWith(target, root);
    expect(id).toBe(7);
    expect(inject).toHaveBeenCalledOnce();
    expect(onCommitFiberRoot).toHaveBeenCalledWith(7, root, 0, false);
    expect(adapter.diagnostics()).toMatchObject({ hookSource: 'existing', rootCount: 1, problems: [] });
  });

  it('takes over a renderer registered before the agent without reporting it when nothing rendered yet', () => {
    const original = {
      supportsFiber: true,
      renderers: new Map([[1, { rendererPackageName: 'react-native-renderer', version: '19.3.0' }]]),
      inject: () => 2,
      getFiberRoots: () => new Set(),
    };
    const { adapter, target } = setup({ [HOOK_KEY]: original });
    expect(adapter.diagnostics()).toMatchObject({ renderers: [expect.objectContaining({ id: 1, kind: 'native' })], problems: [] });
    hookOf(target).onCommitFiberRoot?.(1, makeRoot(host('RCTView', { testID: 'a' })), 0, false);
    expect(adapter.diagnostics().rootCount).toBe(1);
  });

  it('adopts roots rendered before the agent and reports them ("app rendered first")', () => {
    const early = makeRoot(host('RCTView', { testID: 'early' }));
    const original = {
      supportsFiber: true,
      renderers: new Map([[1, { rendererPackageName: 'react-native-renderer', version: '19.3.0' }]]),
      inject: () => 2,
      getFiberRoots: () => new Set([early]),
    };
    const { adapter } = setup({ [HOOK_KEY]: original });
    const d = adapter.diagnostics();
    expect(d.rootCount).toBe(1);
    expect(d.problems[0]).toMatch(/rendered before @quiesco\/agent was installed/);
  });

  it('installEarly() sets up the hook and scheduler that install() then reuses', async () => {
    const { installEarly } = await import('../src/fiber-adapter');
    const target: Record<string, unknown> = {};
    const sched = fakeScheduler();
    installEarly(target, () => sched.mod);
    const hook = target[HOOK_KEY];
    expect(hook).toBeDefined();
    const { adapter } = setup(target, { loadScheduler: () => sched.mod });
    expect(target[HOOK_KEY]).toBe(hook);
    expect(adapter.diagnostics()).toMatchObject({ hookSource: 'installed', schedulerPatched: true, problems: [] });
  });

  it('checkRendererSeen() reports when no renderer ever registered', () => {
    const { adapter, target } = setup();
    expect(adapter.checkRendererSeen()).toMatch(/withQuiesco\(\)/);
    renderWith(target, makeRoot());
    expect(adapter.checkRendererSeen()).toBeNull();
  });

  it('warns about unsupported renderer versions', () => {
    const { adapter, target } = setup();
    renderWith(target, makeRoot(), 'react-native-renderer', '20.0.0');
    expect(adapter.diagnostics().warnings[0]).toMatch(/untested renderer react-native-renderer@20.0.0/);
  });

  it('is idempotent per target (Fast Refresh re-evaluation)', () => {
    const target: Record<string, unknown> = {};
    setup(target);
    const hook = hookOf(target);
    setup(target);
    expect(hookOf(target)).toBe(hook);
  });

  it('notifies commit listeners and survives a throwing listener', () => {
    const { adapter, target } = setup();
    const seen: number[] = [];
    adapter.onCommit(() => {
      throw new Error('boom');
    });
    const off = adapter.onCommit(() => seen.push(1));
    renderWith(target, makeRoot());
    off();
    hookOf(target).onCommitFiberRoot?.(1, makeRoot(), 0, false);
    expect(seen).toEqual([1]);
  });
});

describe('scheduler patch (detector B)', () => {
  it('tracks tasks until they finish, including continuations', () => {
    const { adapter, sched } = setup();
    let calls = 0;
    sched.mod.unstable_scheduleCallback(3, () => (++calls < 2 ? () => ++calls : undefined));
    expect(adapter.pendingSchedulerTasks()).toHaveLength(1);
    sched.runNext(); // returns a continuation
    expect(adapter.pendingSchedulerTasks()[0]).toMatch(/continued ×1/);
    sched.runNext();
    expect(adapter.pendingSchedulerTasks()).toEqual([]);
  });

  it('forgets cancelled tasks and tasks that throw', () => {
    const { adapter, sched } = setup();
    const t = sched.mod.unstable_scheduleCallback(3, () => undefined);
    sched.mod.unstable_scheduleCallback(3, () => {
      throw new Error('x');
    });
    sched.mod.unstable_cancelCallback(t);
    expect(adapter.pendingSchedulerTasks()).toHaveLength(1);
    expect(() => sched.runNext()).not.toThrow(); // cancelled one is skipped
    expect(() => sched.runNext()).toThrow('x');
    expect(adapter.pendingSchedulerTasks()).toEqual([]);
    expect(adapter.diagnostics().schedulerPatched).toBe(true);
  });

  it('reports a problem when the scheduler cannot be loaded', () => {
    const { adapter } = setup({}, {
      loadScheduler: () => {
        throw new Error('not found');
      },
    });
    expect(adapter.diagnostics().problems).toContain('cannot load scheduler: Error: not found');
  });
});

describe('root fields (detector A)', () => {
  it('lists pending lanes, callback node, pending commit and timeout handle', () => {
    const { adapter, target } = setup();
    const root = makeRoot();
    renderWith(target, root);
    expect(adapter.pendingRootWork()).toEqual([]);
    Object.assign(root, { pendingLanes: 32, callbackNode: {}, cancelPendingCommit: () => {}, timeoutHandle: 12 });
    expect(adapter.pendingRootWork()).toEqual(['pendingLanes=0b100000', 'callbackNode', 'cancelPendingCommit', 'timeoutHandle=12']);
  });
});

describe('host tree (native)', () => {
  it('returns only host components, with testID / label / role and render-order text', () => {
    const { adapter, target } = setup();
    renderWith(
      target,
      makeRoot(
        composite('App',
          host('RCTView', { testID: 'card', accessibilityRole: 'button', accessibilityLabel: 'Card' },
            composite('Text', host('RCTText', {}, text('count: '), text(3))),
            host('RCTText', { children: 'ignored on fabric' }, text('B')),
          ),
        ),
      ),
    );
    const [card] = adapter.getHostRoots();
    expect(card).toMatchObject({ type: 'RCTView', testID: 'card', role: 'button', label: 'Card', text: 'count: 3B', ownText: '' });
    expect(card?.children.map((c) => [c.type, c.text, c.ownText])).toEqual([
      ['RCTText', 'count: 3', 'count: 3'],
      ['RCTText', 'B', 'B'],
    ]);
    expect(card?.children[0]?.parent).toBe(card);
  });

  it('flags display:none and opacity:0 from (nested) style arrays', () => {
    const { adapter, target } = setup();
    renderWith(target, makeRoot(
      host('RCTView', { style: [{ opacity: 1 }, [null, { display: 'none' }]] }),
      host('RCTView', { style: { opacity: 0 } }),
      host('RCTView', { style: [{ opacity: 0 }, { opacity: 0.5 }] }),
    ));
    expect(adapter.getHostRoots().map((n) => n.hiddenByStyle)).toEqual([true, true, false]);
  });

  it('reads the native view tag from the public instance', () => {
    const { adapter, target } = setup({}, { platformDeps: { getPublicInstance: () => (f) => ({ __nativeTag: (f.memoizedProps as { tag?: number }).tag }) } });
    renderWith(target, makeRoot(host('RCTView', { tag: 42 }), host('RCTView')));
    expect(adapter.getHostRoots().map((n) => n.nativeTag())).toEqual([42, null]);
  });

  it('isSameElement() compares rendered elements across tree walks', () => {
    const { adapter, target } = setup();
    renderWith(target, makeRoot(host('RCTView', { testID: 'a' }), host('RCTView', { testID: 'b' })));
    const [a1, b1] = adapter.getHostRoots();
    const [a2] = adapter.getHostRoots();
    expect(a1).not.toBe(a2);
    expect(a1!.isSameElement(a2!)).toBe(true);
    expect(a1!.isSameElement(b1!)).toBe(false);
  });

  it('measures through the public instance and returns null on failure', () => {
    const { adapter, target } = setup();
    renderWith(target, makeRoot(host('RCTView', { __rect: { x: 1, y: 2, width: 3, height: 4 } }), host('RCTView')));
    const [a, b] = adapter.getHostRoots();
    expect(a?.measure()).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(b?.measure()).toBeNull();
  });

  it('limits the tree to the scope component (excludes dev-client overlays)', () => {
    const { adapter, target } = setup();
    const Scope = function QuiescoRoot() {};
    renderWith(target, makeRoot(host('RCTView', { testID: 'overlay' }), composite(Scope, host('RCTView', { testID: 'app' }))));
    adapter.setScope(Scope);
    expect(adapter.getHostRoots().map((n) => n.testID)).toEqual(['app']);
    adapter.setScope(null);
    expect(adapter.getHostRoots().map((n) => n.testID)).toEqual(['overlay', 'app']);
  });

  it('gives the viewport of the renderer in use', () => {
    const { adapter, target } = setup();
    expect(adapter.viewport()).toBeNull();
    renderWith(target, makeRoot());
    expect(adapter.viewport()).toEqual({ width: 400, height: 800 });
  });
});

describe('host tree (web: react-dom + react-native-web)', () => {
  it('reads data-testid / aria-*, string children text, and skips hoistables', () => {
    const { adapter, target } = setup({}, {
      platformDeps: { getComputedStyle: (el) => ((el as { hidden?: boolean }).hidden ? { display: 'none', opacity: '1' } : { display: 'block', opacity: '1' }) },
    });
    renderWith(
      target,
      makeRoot(
        special(WorkTag.HostSingleton, 'body',
          special(WorkTag.HostHoistable, 'title', text('Page title')),
          composite('Pressable',
            host('button', { 'data-testid': 'go', role: 'button', 'aria-label': 'Go', children: 'Go!' }),
          ),
        ),
      ),
      'react-dom',
    );
    const roots = adapter.getHostRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ type: 'button', testID: 'go', role: 'button', label: 'Go', text: 'Go!', ownText: 'Go!', hiddenByStyle: false });
  });

  it('uses the computed style for hiding and stateNode for measuring', () => {
    const { adapter, target } = setup({}, { platformDeps: { getComputedStyle: () => ({ display: 'none', opacity: '1' }) } });
    renderWith(target, makeRoot(host('div', { __rect: { x: 0, y: 0, width: 10, height: 10 } })), 'react-dom');
    const [div] = adapter.getHostRoots();
    expect(div?.hiddenByStyle).toBe(true);
    expect(div?.measure()).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
});

describe('HostNode lookups used by js actions', () => {
  class FakeScrollView {
    calls: unknown[] = [];
    scrollTo(arg: unknown) {
      this.calls.push(arg);
    }
  }

  it('ownerProps() merges composites between the host and the parent host, nearest first', () => {
    const { adapter, target } = setup();
    const outer = { tag: 0, type: 'Outer', props: { value: 'outer', testID: 'outer' }, children: [] as never[] };
    renderWith(target, makeRoot(
      { ...outer, children: [host('RCTView', {}, { tag: 0, type: 'TextInput', props: { value: 'abc', editable: false }, children: [{ tag: 0, type: 'Inner', props: { value: 'inner' }, children: [host('AndroidTextInput', { text: 'abc' })] }] })] },
    ));
    const input = adapter.getHostRoots()[0]!.children[0]!;
    expect(input.ownerProps()).toMatchObject({ value: 'inner', editable: false });
    expect(input.ownerProps()).not.toHaveProperty('testID'); // stops at the parent host
  });

  it('findHandler() walks up across hosts to the nearest function prop', () => {
    const { adapter, target } = setup();
    const onPress = vi.fn();
    renderWith(target, makeRoot(
      { tag: 0, type: 'Pressable', props: { onPress, disabled: false }, children: [host('RCTView', {}, composite('Text', host('RCTText', {}, text('Go'))))] },
    ));
    const label = adapter.getHostRoots()[0]!.children[0]!;
    const h = label.findHandler('onPress');
    expect(h?.fn).toBe(onPress);
    expect(h?.props).toMatchObject({ disabled: false });
    expect(label.findHandler('onLongPress')).toBeNull();
  });

  it('findInstance() finds the nearest class instance with the method and its host nodes', () => {
    const { adapter, target } = setup();
    const sv = new FakeScrollView();
    renderWith(target, makeRoot(
      { tag: WorkTag.ClassComponent, type: 'ScrollView', props: {}, stateNode: sv, children: [host('RCTScrollView', { testID: 'list' }, host('RCTScrollContentView', {}, host('RCTView', { testID: 'row' })))] },
    ));
    const row = adapter.getHostRoots()[0]!.children[0]!.children[0]!;
    const inst = row.findInstance('scrollTo');
    inst?.call({ y: 10 });
    expect(sv.calls).toEqual([{ y: 10 }]);
    expect(inst?.hostNodes().map((n) => n.testID)).toEqual(['list']);
    expect(row.findInstance('nope')).toBeNull();
  });
});

describe('HostNode: owner names, focus, clipping, input value (Phase 6.1)', () => {
  it('ownerNames(): named composites between the host and the nearest host ancestor, nearest first', () => {
    const { adapter, target } = setup();
    function TodoCard(): null {
      return null;
    }
    const Pressable = Object.assign(() => null, { displayName: 'Pressable' });
    const forwardRefView = { $$typeof: Symbol.for('react.forward_ref'), render: function View() {} };
    const anonymous = (() => () => null)(); // no inferred name
    const memoAnon = { $$typeof: Symbol.for('react.memo'), type: anonymous };
    renderWith(target, makeRoot(
      composite(TodoCard, composite(Pressable, composite(forwardRefView, composite(memoAnon, host('RCTView', { testID: 'card' }, composite(TodoCard, host('RCTText', {}, text('x')))))))),
    ));
    const [card] = adapter.getHostRoots();
    expect(card?.ownerNames()).toEqual(['View', 'Pressable', 'TodoCard']);
    expect(card?.renderedWithParent).toBe(false); // top-level host
    expect(card?.children[0]?.renderedWithParent).toBe(false); // TodoCard in between
    // Names stop at the nearest host ancestor.
    expect(card?.children[0]?.ownerNames()).toEqual(['TodoCard']);
  });

  it('native: focus via the focused public instance, clipping via scroll hosts and overflow style, input text prop', () => {
    let focused: unknown = null;
    const { adapter, target } = setup({}, {
      platformDeps: { getPublicInstance: () => (f) => f.stateNode, viewport: () => ({ width: 400, height: 800 }), focusedElement: () => focused },
    });
    renderWith(target, makeRoot(
      host('RCTScrollView', {},
        host('AndroidTextInput', { testID: 'email', text: 'typed', value: 'old' }),
        host('RCTView', { style: [{ overflow: 'hidden' }] }),
        host('RCTView', { style: { overflow: 'visible' } }),
      ),
    ));
    const [scroll] = adapter.getHostRoots();
    const [input, hidden, visible] = scroll!.children;
    expect(scroll?.clipsContent).toBe(true);
    expect([hidden?.clipsContent, visible?.clipsContent]).toEqual([true, false]);
    expect(input?.inputValue()).toBe('typed');
    expect(hidden?.inputValue()).toBeUndefined();
    expect(input?.isFocused()).toBe(false);
    focused = (adapter.getHostRoots()[0]!.children[0] as unknown as { fiber: { stateNode: unknown } }).fiber.stateNode;
    expect(adapter.getHostRoots()[0]!.children[0]!.isFocused()).toBe(true);
  });

  it('web: focus via the active element, clipping via computed overflow, live DOM value', () => {
    let active: unknown = null;
    const { adapter, target } = setup({}, {
      platformDeps: {
        focusedElement: () => active,
        getComputedStyle: (el) => ({ display: 'block', opacity: '1', overflowX: 'visible', overflowY: (el as { scrolls?: boolean }).scrolls ? 'auto' : 'visible' }),
      },
    });
    renderWith(target, makeRoot(host('div', {}, host('input', { type: 'text', value: 'stale' }), special(7, 'Fragment', host('input', { type: 'checkbox' })))), 'react-dom');
    const [div] = adapter.getHostRoots();
    const [textbox, checkbox] = div!.children;
    // Created directly in the div's render (a Fragment is not a component).
    expect([textbox?.renderedWithParent, checkbox?.renderedWithParent]).toEqual([true, true]);
    const domText = (textbox as unknown as { fiber: { stateNode: Record<string, unknown> } }).fiber.stateNode;
    domText['value'] = 'live';
    expect(textbox?.inputValue()).toBe('live');
    expect(checkbox?.inputValue()).toBeUndefined();
    expect(div?.clipsContent).toBe(false);
    (div as unknown as { fiber: { stateNode: Record<string, unknown> } }).fiber.stateNode['scrolls'] = true;
    expect(adapter.getHostRoots()[0]?.clipsContent).toBe(true);
    active = domText;
    expect(textbox?.isFocused()).toBe(true);
    expect(checkbox?.isFocused()).toBe(false);
  });
});

describe('component lookup (Phase 6.3)', () => {
  it('findProps returns the nearest fiber whose props match, with its component name, within a depth', () => {
    const { adapter, target } = setup();
    function Slider() {
      return null;
    }
    renderWith(
      target,
      makeRoot({ tag: WorkTag.FunctionComponent, type: Slider, props: { value: 3, onValueChange: () => {} }, children: [host('RCTSlider', { testID: 's', onChange: () => {} })] }),
    );
    const [s] = adapter.getHostRoots();
    expect(s?.findProps((p) => typeof p['onChange'] === 'function')).toMatchObject({ name: null }); // the host itself
    expect(s?.findProps((p) => typeof p['onValueChange'] === 'function')).toMatchObject({ name: 'Slider', props: { value: 3 } });
    expect(s?.findProps((p) => typeof p['onValueChange'] === 'function', 0)).toBeNull();
  });

  it('findHostlessComposites finds components rendering no host, outermost only', () => {
    const { adapter, target } = setup();
    function Picker() {
      return null;
    }
    function Inner() {
      return null;
    }
    renderWith(
      target,
      makeRoot(
        host('RCTView', {},
          { tag: WorkTag.FunctionComponent, type: Picker, props: { testID: 'when' }, children: [{ tag: WorkTag.FunctionComponent, type: Inner, props: { testID: 'when' }, children: [] }] },
          { tag: WorkTag.FunctionComponent, type: Picker, props: { testID: 'other' }, children: [host('RCTView', { testID: 'rendered' })] },
        ),
      ),
    );
    const found = adapter.findHostlessComposites((c) => c.testID === 'when');
    expect(found.map((c) => [c.name, c.rendersHost])).toEqual([['Picker', false]]);
    expect(adapter.findHostlessComposites((c) => c.testID === 'other')).toEqual([]);
  });
});
