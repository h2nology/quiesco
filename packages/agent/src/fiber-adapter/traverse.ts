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
import type { CompositeNode, HandlerRef, HostNode, InstanceRef, PropsRef, PropsTest } from './types';

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
  displayText = '';

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

  focus(): boolean {
    return this.platform.focus(this.fiber);
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

  findProps(test: PropsTest, maxDepth = DEFAULT_PROPS_DEPTH): PropsRef | null {
    return findPropsFrom(this.fiber, test, maxDepth);
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
        raw: () => inst,
      };
    }
    return null;
  }
}

/** How far up `findProps` looks by default: the components wrapping a control, not the whole screen. */
const DEFAULT_PROPS_DEPTH = 12;

function findPropsFrom(start: Fiber, test: PropsTest, maxDepth: number): PropsRef | null {
  let depth = 0;
  for (let f: Fiber | null = start; f !== null && f.tag !== WorkTag.HostRoot && depth <= maxDepth; f = f.return, depth++) {
    if (f.tag === WorkTag.HostText || !isObject(f.memoizedProps)) continue;
    const name = COMPONENT_TAGS.has(f.tag) ? componentName(f.type) : null;
    if (test(f.memoizedProps, name, depth)) return { props: f.memoizedProps, name, depth };
  }
  return null;
}

class Composite implements CompositeNode {
  readonly name: string | null;
  readonly props: Readonly<Record<string, unknown>>;
  readonly testID: string | undefined;
  readonly rendersHost: boolean;

  constructor(private readonly fiber: Fiber) {
    this.name = componentName(fiber.type);
    this.props = isObject(fiber.memoizedProps) ? fiber.memoizedProps : {};
    this.testID = typeof this.props['testID'] === 'string' ? this.props['testID'] : undefined;
    this.rendersHost = hasHost(fiber.child);
  }

  findProps(test: PropsTest, maxDepth = DEFAULT_PROPS_DEPTH): PropsRef | null {
    return findPropsFrom(this.fiber, test, maxDepth);
  }
}

function hasHost(first: Fiber | null): boolean {
  for (const f of walkSiblings(first)) if (f.tag === WorkTag.HostComponent || f.tag === WorkTag.HostText) return true;
  return false;
}

/**
 * Component fibers under `fiber` (pre-order) that render no host element and satisfy `test`. A match's
 * descendants are not searched: a wrapper passing its testID down to an inner component is one target.
 */
export function findHostlessComposites(fiber: Fiber, test: (c: CompositeNode) => boolean): CompositeNode[] {
  const out: CompositeNode[] = [];
  const stack: Fiber[] = [];
  let f: Fiber | null = fiber.child;
  while (f !== null || stack.length > 0) {
    if (f === null) f = stack.pop() ?? null;
    if (f === null) break;
    if (f.sibling !== null) stack.push(f.sibling);
    if (COMPONENT_TAGS.has(f.tag) && !hasHost(f.child)) {
      const c = new Composite(f);
      if (test(c)) {
        out.push(c);
        f = null;
        continue;
      }
    }
    f = f.child;
  }
  return out;
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

/** Text gathered while collecting the host nodes below one parent host. */
interface TextAcc {
  /** All text, in render order. */
  text: string;
  /** Text not inside a child host. */
  own: string;
  /** Display text (HostNode.displayText). */
  display: string;
  /** The last piece added to `display` was a separate block (a host that is not an inline text run). */
  lastBlock: boolean;
}

/** Append a piece of display text: a space between separate blocks, none inside one text. */
function addDisplay(acc: TextAcc, piece: string, block: boolean): void {
  if (piece === '') return;
  acc.display = acc.display === '' ? piece : acc.display + (block || acc.lastBlock ? ' ' : '') + piece;
  acc.lastBlock = block;
}

/**
 * Collect host nodes under `first` and its siblings into `out` (children of `parent`), adding their
 * text to `acc`. `viaComponent`: a component fiber lies between `parent` and `first`.
 */
function collect(first: Fiber | null, parent: Node | null, platform: HostPlatform, out: Node[], acc: TextAcc, viaComponent = false): void {
  for (let f = first; f !== null; f = f.sibling) {
    switch (f.tag) {
      case WorkTag.HostComponent: {
        const node = new Node(f, platform, parent, viaComponent);
        const mine = stringChildren(f);
        const inner: TextAcc = { text: mine, own: mine, display: mine, lastBlock: false };
        collect(f.child, node, platform, node.children, inner);
        node.text = inner.text;
        node.ownText = inner.own;
        node.displayText = inner.display;
        out.push(node);
        acc.text += node.text;
        addDisplay(acc, node.displayText, !platform.inlineText(node.type));
        break;
      }
      case WorkTag.HostText:
        if (typeof f.memoizedProps === 'string' || typeof f.memoizedProps === 'number') {
          const t = String(f.memoizedProps);
          acc.text += t;
          acc.own += t;
          addDisplay(acc, t, false);
        }
        break;
      case WorkTag.HostHoistable:
        break;
      default:
        collect(f.child, parent, platform, out, acc, viaComponent || COMPONENT_TAGS.has(f.tag));
    }
  }
}

/** Host nodes directly below `fiber` (the fiber itself is not included). */
export function buildHostTree(fiber: Fiber, platform: HostPlatform): HostNode[] {
  const out: Node[] = [];
  collect(fiber.child, null, platform, out, { text: '', own: '', display: '', lastBlock: false });
  return out;
}

/** First fiber (pre-order) whose component type is `type`. */
export function findFiberByType(start: Fiber, type: unknown): Fiber | null {
  for (const f of walkSiblings(start)) if (f.type === type) return f;
  return null;
}
