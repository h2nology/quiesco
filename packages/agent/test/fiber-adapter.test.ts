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

  it('reports a problem when a renderer was injected before the agent ("installed too late")', () => {
    const original = { supportsFiber: true, renderers: new Map([[1, { rendererPackageName: 'react-native-renderer', version: '19.3.0' }]]), inject: () => 2 };
    const { adapter } = setup({ [HOOK_KEY]: original });
    expect(adapter.diagnostics().problems[0]).toMatch(/loaded after the React renderer/);
  });

  it('checkRendererSeen() reports when no renderer ever registered', () => {
    const { adapter, target } = setup();
    expect(adapter.checkRendererSeen()).toMatch(/first line of the app entry/);
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
