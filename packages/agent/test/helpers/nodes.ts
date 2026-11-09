/** Build HostNode trees directly (query-layer tests do not need fibers). */
import type { Rect } from '@quiesco/protocol';

import type { HandlerRef, HostNode, InstanceRef, PropsRef } from '../../src/fiber-adapter';

export interface NodeSpec {
  type?: string;
  testID?: string;
  label?: string;
  role?: string;
  text?: string;
  hidden?: boolean;
  rect?: Rect | null;
  props?: Record<string, unknown>;
  /** Props of the composite components that render this host (ownerProps / findHandler). */
  owner?: Record<string, unknown>;
  /** Handlers found on ancestors (findHandler falls back to these). */
  ancestorHandlers?: Record<string, unknown>;
  /** Props of components further up, nearest first (findProps searches props → owner → these). */
  ancestors?: { props: Record<string, unknown>; name?: string }[];
  /** findInstance(method) result. */
  instance?: InstanceRef | null;
  tag?: number | null;
  /** ownerNames(): component names rendering this host, nearest first. */
  ownerNames?: string[];
  focused?: boolean;
  /** Clips its descendants (scroll view / overflow hidden). */
  clips?: boolean;
  /** inputValue(): live text of a text input. */
  inputValue?: string;
  /** Created directly in the parent's render (no component in between). */
  withParent?: boolean;
  /** Incremented by focus(). */
  focusCalls?: number;
  children?: NodeSpec[];
}

interface MutableNode extends HostNode {
  spec: NodeSpec;
  children: MutableNode[];
  text: string;
  ownText: string;
  parent: MutableNode | null;
  rect: Rect | null;
}

export function node(spec: NodeSpec, parent: MutableNode | null = null): MutableNode {
  const n: MutableNode = {
    spec,
    type: spec.type ?? 'RCTView',
    props: spec.props ?? {},
    testID: spec.testID,
    label: spec.label,
    role: spec.role,
    hiddenByStyle: spec.hidden ?? false,
    clipsContent: spec.clips ?? false,
    renderedWithParent: spec.withParent ?? false,
    parent,
    children: [],
    ownText: spec.text ?? '',
    text: '',
    rect: spec.rect === undefined ? { x: 0, y: 0, width: 100, height: 20 } : spec.rect,
    measure() {
      return this.rect;
    },
    ownerProps: () => spec.owner ?? {},
    ownerNames: () => spec.ownerNames ?? [],
    isFocused: () => spec.focused ?? false,
    inputValue: () => spec.inputValue,
    focus: () => {
      spec.focusCalls = (spec.focusCalls ?? 0) + 1;
      return true;
    },
    findHandler(name: string): HandlerRef | null {
      for (const p of [spec.props ?? {}, spec.owner ?? {}, spec.ancestorHandlers ?? {}]) {
        if (typeof p[name] === 'function') return { fn: p[name] as HandlerRef['fn'], props: p };
      }
      return null;
    },
    findProps(test, maxDepth = 12): PropsRef | null {
      const chain: { props: Record<string, unknown>; name: string | null }[] = [
        { props: spec.props ?? {}, name: null },
        ...(spec.owner !== undefined ? [{ props: spec.owner, name: spec.ownerNames?.[0] ?? null }] : []),
        ...(spec.ancestors ?? []).map((a) => ({ props: a.props, name: a.name ?? null })),
      ];
      for (const c of chain.slice(0, maxDepth + 1)) if (test(c.props)) return c;
      return null;
    },
    findInstance: () => spec.instance ?? null,
    nativeTag: () => spec.tag ?? null,
    // Same element = built from the same spec object (mirrors "same host instance").
    isSameElement(other) {
      return (other as unknown as { spec?: NodeSpec }).spec === spec;
    },
  };
  n.children = (spec.children ?? []).map((c) => node(c, n));
  n.text = n.ownText + n.children.map((c) => c.text).join('');
  return n;
}

export const tree = (...specs: NodeSpec[]): MutableNode[] => specs.map((s) => node(s));
