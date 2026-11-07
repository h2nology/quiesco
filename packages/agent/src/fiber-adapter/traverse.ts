/**
 * Build the renderer-independent HostNode tree from fiber roots.
 * Rules (docs/spikes/07-web-fiber-query.md "查询规则"):
 * - Only HostComponent fibers become nodes; composite fibers are transparent.
 * - Text = HostText fibers + `memoizedProps.children` (string/number) of hosts WITHOUT child fibers
 *   (react-dom's shouldSetTextContent case; reading it only when there are no child fibers avoids
 *   double counting on Fabric).
 * - HostSingleton (html/head/body) is transparent; HostHoistable (<title>, <link>, ...) is skipped.
 */
import type { Rect } from '@quiesco/protocol';

import type { Fiber } from './fiber';
import { WorkTag, isObject, walkSiblings } from './fiber';
import type { HostPlatform } from './host';
import type { HandlerRef, HostNode, InstanceRef } from './types';

class Node implements HostNode {
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly testID: string | undefined;
  readonly label: string | undefined;
  readonly role: string | undefined;
  readonly hiddenByStyle: boolean;
  readonly children: Node[] = [];
  text = '';
  ownText = '';

  constructor(
    private readonly fiber: Fiber,
    private readonly platform: HostPlatform,
    readonly parent: Node | null,
  ) {
    const props = isObject(fiber.memoizedProps) ? fiber.memoizedProps : {};
    this.type = typeof fiber.type === 'string' ? fiber.type : String(fiber.type);
    this.props = props;
    this.testID = platform.testID(props);
    this.label = platform.label(props);
    this.role = platform.role(props);
    this.hiddenByStyle = platform.hiddenByStyle(fiber, props);
  }

  measure(): Rect | null {
    return this.platform.measure(this.fiber);
  }

  ownerProps(): Readonly<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (let f = this.fiber.return; f !== null && !isHostBoundary(f); f = f.return) {
      if (f.tag === WorkTag.HostText || !isObject(f.memoizedProps)) continue;
      for (const [k, v] of Object.entries(f.memoizedProps)) if (!(k in out)) out[k] = v;
    }
    return out;
  }

  findHandler(name: string): HandlerRef | null {
    for (let f: Fiber | null = this.fiber; f !== null && f.tag !== WorkTag.HostRoot; f = f.return) {
      const p = f.memoizedProps;
      if (isObject(p) && typeof p[name] === 'function') return { fn: p[name] as HandlerRef['fn'], props: p };
    }
    return null;
  }

  findInstance(method: string): InstanceRef | null {
    for (let f = this.fiber.return; f !== null && f.tag !== WorkTag.HostRoot; f = f.return) {
      const inst = f.stateNode;
      if (f.tag !== WorkTag.ClassComponent || !isObject(inst) || typeof inst[method] !== 'function') continue;
      const owner = f;
      const platform = this.platform;
      return {
        call: (...args) => (inst[method] as (...a: unknown[]) => unknown).apply(inst, args),
        hostNodes: () => buildHostTree(owner, platform),
      };
    }
    return null;
  }
}

function isHostBoundary(f: Fiber): boolean {
  return f.tag === WorkTag.HostComponent || f.tag === WorkTag.HostRoot || f.tag === WorkTag.HostPortal;
}

function stringChildren(fiber: Fiber): string {
  if (fiber.child !== null || !isObject(fiber.memoizedProps)) return '';
  const c = fiber.memoizedProps['children'];
  return typeof c === 'string' || typeof c === 'number' ? String(c) : '';
}

/**
 * Collect host nodes under `first` and its siblings into `out` (children of `parent`).
 * Returns [all text, text not inside a child host], both in render order.
 */
function collect(first: Fiber | null, parent: Node | null, platform: HostPlatform, out: Node[]): [string, string] {
  let text = '';
  let own = '';
  for (let f = first; f !== null; f = f.sibling) {
    switch (f.tag) {
      case WorkTag.HostComponent: {
        const node = new Node(f, platform, parent);
        const [childText, childOwn] = collect(f.child, node, platform, node.children);
        const mine = stringChildren(f);
        node.text = mine + childText;
        node.ownText = mine + childOwn;
        out.push(node);
        text += node.text;
        break;
      }
      case WorkTag.HostText:
        if (typeof f.memoizedProps === 'string' || typeof f.memoizedProps === 'number') {
          text += String(f.memoizedProps);
          own += String(f.memoizedProps);
        }
        break;
      case WorkTag.HostHoistable:
        break;
      default: {
        const [t, o] = collect(f.child, parent, platform, out);
        text += t;
        own += o;
      }
    }
  }
  return [text, own];
}

/** Host nodes directly below `fiber` (the fiber itself is not included). */
export function buildHostTree(fiber: Fiber, platform: HostPlatform): HostNode[] {
  const out: Node[] = [];
  collect(fiber.child, null, platform, out);
  return out;
}

/** First fiber (pre-order) whose component type is `type`. */
export function findFiberByType(start: Fiber, type: unknown): Fiber | null {
  for (const f of walkSiblings(start)) if (f.type === type) return f;
  return null;
}
