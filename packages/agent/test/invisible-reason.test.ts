import { describe, expect, it } from 'vitest';

import type { HostNode } from '../src/fiber-adapter';
import { invisibleReason } from '../src/query';

type Opts = { type?: string; testID?: string; props?: Record<string, unknown>; hidden?: boolean; clips?: boolean; rect?: { x: number; y: number; width: number; height: number } | null };

function node(o: Opts, parent: HostNode | null = null): HostNode {
  const rect = o.rect === undefined ? { x: 0, y: 0, width: 10, height: 10 } : o.rect;
  return {
    type: o.type ?? 'RCTView',
    props: o.props ?? {},
    testID: o.testID,
    hiddenByStyle: o.hidden ?? false,
    clipsContent: o.clips ?? false,
    parent,
    children: [],
    measure: () => rect,
  } as unknown as HostNode;
}

const viewport = { width: 100, height: 200 };

describe('invisibleReason', () => {
  it('names the screen that is not on top, the hidden ancestor, or the node itself', () => {
    const covered = 'it is on a screen that is not on top (another screen covers it)';
    // a ScreenContainer's inactive screen (tabs)
    expect(invisibleReason(node({}, node({ type: 'RNSScreen', props: { activityState: 0 } })), viewport)).toBe(covered);
    expect(invisibleReason(node({}, node({ type: 'RNSScreen', props: { activityState: 2 } })), viewport)).toBeNull();
    // a native stack: screens below stay at activityState 2; the later screen covers them unless transparent
    const stack = (...later: Record<string, unknown>[]) => {
      const s = node({ type: 'RNSScreenStack' }) as unknown as { children: HostNode[] };
      const below = node({ type: 'RNSScreen', props: { activityState: 2 } }, s as unknown as HostNode);
      s.children = [below, ...later.map((props) => node({ type: 'RNSScreen', props }, s as unknown as HostNode))];
      return node({ testID: 'home' }, below);
    };
    expect(invisibleReason(stack({ activityState: 2 }), viewport)).toBe(covered);
    expect(invisibleReason(stack({ activityState: 2, stackPresentation: 'transparentModal' }), viewport)).toBeNull();
    expect(invisibleReason(node({}, node({ type: 'RNSScreen' }, node({ type: 'RNSScreenStack' }))), viewport)).toBeNull(); // alone in its stack

    expect(invisibleReason(node({}, node({ type: 'div', testID: 'page', hidden: true })), viewport)).toBe('an ancestor <div testID="page"> is hidden (display: none or opacity: 0), e.g. a screen that is not on top');
    expect(invisibleReason(node({ hidden: true }), viewport)).toBe('it is hidden by its style (display: none or opacity: 0)');
  });

  it('size, window and clipping', () => {
    expect(invisibleReason(node({ rect: null }), viewport)).toBe('it is not laid out (it cannot be measured)');
    expect(invisibleReason(node({ rect: { x: 0, y: 0, width: 0, height: 20 } }), viewport)).toBe('it has no size (0×20)');
    expect(invisibleReason(node({ rect: { x: 0, y: 300, width: 10, height: 10 } }), viewport)).toBe('it is outside the window (at 0,300; the window is 100×200): scroll to it');
    const scroll = node({ type: 'RCTScrollView', clips: true, rect: { x: 0, y: 0, width: 100, height: 50 } });
    expect(invisibleReason(node({ rect: { x: 0, y: 80, width: 10, height: 10 } }, scroll), viewport)).toBe('it is clipped by a scroll view or an `overflow` ancestor: scroll to it');
    expect(invisibleReason(node({}), viewport)).toBeNull();
  });
});
