import type { JsonValue } from './json.js';

/** Rectangle in the platform's logical units (dp on Android, pt on iOS, CSS px on web), window coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the agent reports about a matched element. */
export interface ElementSummary {
  /** Host component type, e.g. `RCTView`, `RCTText`, `div`. */
  type: string;
  testID?: string;
  text: string;
  role?: string;
  label?: string;
  rect: Rect | null;
  visible: boolean;
  /** Serializable subset of the element's props (functions and React elements are dropped). */
  props: Record<string, JsonValue>;
}

/** Compact element tree for diagnostics (`getTree`). */
export interface TreeNode {
  type: string;
  testID?: string;
  text?: string;
  role?: string;
  /** Rounded rect. */
  rect?: Rect;
  children: TreeNode[];
}
