/** Build HostNode trees directly (query-layer tests do not need fibers). */
import type { Rect } from '@quiesco/protocol';

import type { HostNode } from '../../src/fiber-adapter';

export interface NodeSpec {
  type?: string;
  testID?: string;
  label?: string;
  role?: string;
  text?: string;
  hidden?: boolean;
  rect?: Rect | null;
  props?: Record<string, unknown>;
  children?: NodeSpec[];
}

interface MutableNode extends HostNode {
  children: MutableNode[];
  text: string;
  ownText: string;
  parent: MutableNode | null;
  rect: Rect | null;
}

export function node(spec: NodeSpec, parent: MutableNode | null = null): MutableNode {
  const n: MutableNode = {
    type: spec.type ?? 'RCTView',
    props: spec.props ?? {},
    testID: spec.testID,
    label: spec.label,
    role: spec.role,
    hiddenByStyle: spec.hidden ?? false,
    parent,
    children: [],
    ownText: spec.text ?? '',
    text: '',
    rect: spec.rect === undefined ? { x: 0, y: 0, width: 100, height: 20 } : spec.rect,
    measure() {
      return this.rect;
    },
  };
  n.children = (spec.children ?? []).map((c) => node(c, n));
  n.text = n.ownText + n.children.map((c) => c.text).join('');
  return n;
}

export const tree = (...specs: NodeSpec[]): MutableNode[] => specs.map((s) => node(s));
