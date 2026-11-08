import type { Rect } from '@quiesco/protocol';

/**
 * Renderer-independent element model. This is the ONLY shape the rest of the agent sees;
 * Fiber objects never leave `fiber-adapter/` (requirements.md §3-3).
 */
export interface HostNode {
  /** Host component type: `RCTView`, `RCTText`, `div`, ... */
  readonly type: string;
  /** Raw React props of the host fiber (read-only view; may contain functions / elements). */
  readonly props: Readonly<Record<string, unknown>>;
  /** `testID` (native) or `data-testid` (react-native-web). */
  readonly testID: string | undefined;
  /** `accessibilityLabel` / `aria-label`. */
  readonly label: string | undefined;
  /** `accessibilityRole` / `role`. */
  readonly role: string | undefined;
  /** Concatenated text of this node's subtree, in render order. */
  readonly text: string;
  /** Text directly inside this node, excluding text of child host nodes (e.g. an RCTText's own string). */
  readonly ownText: string;
  /** `display: none` or `opacity: 0` on this node itself (ancestors are not considered). */
  readonly hiddenByStyle: boolean;
  readonly parent: HostNode | null;
  readonly children: readonly HostNode[];
  /** Window coordinates in logical units (dp / pt / CSS px), or null if the node cannot be measured. */
  measure(): Rect | null;
  /** React view tag of the underlying native view (Fabric), or null (web, unmounted). */
  nativeTag(): number | null;
  /**
   * Whether `other` is the same rendered element. HostNode objects are rebuilt on every tree walk, so
   * identity is the underlying host instance (Fabric instance / DOM element), not the object.
   */
  isSameElement(other: HostNode): boolean;
  /**
   * Merged props of the composite components that render this host directly (between it and the
   * nearest ancestor host), nearest first. E.g. a Pressable's `disabled`, a TextInput's `value`.
   */
  ownerProps(): Readonly<Record<string, unknown>>;
  /** Nearest component (this host or an ancestor, up to the root) with a function prop `name`. */
  findHandler(name: string): HandlerRef | null;
  /** Nearest ancestor class component instance with a method `name` (e.g. ScrollView's `scrollTo`). */
  findInstance(method: string): InstanceRef | null;
}

export interface HandlerRef {
  fn: (...args: unknown[]) => unknown;
  /** All props of the component that owns the handler (for `disabled`, sibling handlers, ...). */
  props: Readonly<Record<string, unknown>>;
}

export interface InstanceRef {
  /** Call the method on the instance. */
  call(...args: unknown[]): unknown;
  /** Top-level host nodes rendered by the component (e.g. the native scroll view). */
  hostNodes(): HostNode[];
}

export type RendererKind = 'native' | 'web';

export interface RendererInfo {
  id: number;
  packageName: string;
  version: string;
  /** 0 = production, 1 = development (React DevTools convention). */
  bundleType: number;
  kind: RendererKind;
  supported: boolean;
}

export interface AdapterDiagnostics {
  /** `existing`: wrapped a hook installed by React DevTools; `installed`: we installed a minimal hook. */
  hookSource: 'existing' | 'installed' | 'none';
  schedulerPatched: boolean;
  renderers: RendererInfo[];
  rootCount: number;
  /** Problems the user must fix (e.g. the agent was imported after React Native's renderer). */
  problems: string[];
  /** Non-fatal notices (e.g. untested renderer version). */
  warnings: string[];
}

/** Window size in the same units as `HostNode.measure()`. */
export interface Viewport {
  width: number;
  height: number;
}
