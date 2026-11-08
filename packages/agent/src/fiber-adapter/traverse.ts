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
  readonly clipsContent: boolean;
  readonly renderedWithParent: boolean;
  readonly children: Node[] = [];
  text = '';
  ownText = '';

  constructor(
    private readonly fiber: Fiber,
    private readonly platform: HostPlatform,
    readonly parent: Node | null,
    viaComponent: boolean,
  ) {
    const props = isObject(fiber.memoizedProps) ? fiber.memoizedProps : {};
    this.type = typeof fiber.type === 'string' ? fiber.type : String(fiber.type);
    this.props = props;
    this.testID = platform.testID(props);
    this.label = platform.label(props);
    this.role = platform.role(props);
    this.hiddenByStyle = platform.hiddenByStyle(fiber, props);
    this.clipsContent = platform.clipsContent(this.type, fiber, props);
    this.renderedWithParent = parent !== null && !viaComponent;
  }

  ownerNames(): readonly string[] {
    const out: string[] = [];
    for (let f = this.fiber.return; f !== null && !isHostBoundary(f); f = f.return) {
      const name = componentName(f.type);
      if (name !== null && !out.includes(name)) out.push(name);
    }
    return out;
  }

  isFocused(): boolean {
    return this.platform.isFocused(this.fiber);
  }

  inputValue(): string | undefined {
    return this.platform.inputValue(this.type, this.fiber, this.props as Record<string, unknown>);
  }

  measure(): Rect | null {
    return this.platform.measure(this.fiber);
  }

  nativeTag(): number | null {
    return this.platform.nativeTag(this.fiber);
  }

  isSameElement(other: HostNode): boolean {
    if (other === this) return true;
    if (!(other instanceof Node)) return false;
    const a = this.fiber.stateNode;
    return (a !== null && a !== undefined && a === other.fiber.stateNode) || this.fiber === other.fiber;
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

/** Display name of a component type: function / class, forwardRef, memo. Null for anonymous ones. */
function componentName(type: unknown): string | null {
  const named = (t: unknown): string | null => {
    if (typeof t !== 'function' && !isObject(t)) return null;
    const o = t as { displayName?: unknown; name?: unknown };
    if (typeof o.displayName === 'string' && o.displayName !== '') return o.displayName;
    return typeof t === 'function' && typeof o.name === 'string' && o.name !== '' ? o.name : null;
  };
  const direct = named(type);
  if (direct !== null || !isObject(type)) return direct;
  return named(type['render']) ?? named(type['type']);
}

const COMPONENT_TAGS: ReadonlySet<number> = new Set([
  WorkTag.FunctionComponent,
  WorkTag.ClassComponent,
  WorkTag.ForwardRef,
  WorkTag.MemoComponent,
  WorkTag.SimpleMemoComponent,
]);

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
 * `viaComponent`: a component fiber lies between `parent` and `first`.
 * Returns [all text, text not inside a child host], both in render order.
 */
function collect(first: Fiber | null, parent: Node | null, platform: HostPlatform, out: Node[], viaComponent = false): [string, string] {
  let text = '';
  let own = '';
  for (let f = first; f !== null; f = f.sibling) {
    switch (f.tag) {
      case WorkTag.HostComponent: {
        const node = new Node(f, platform, parent, viaComponent);
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
        const [t, o] = collect(f.child, parent, platform, out, viaComponent || COMPONENT_TAGS.has(f.tag));
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
