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
