import type { JsonValue } from './json.js';
import type { SemanticType } from './matcher.js';

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
  /**
   * Visible fraction of the element's area (0–1): the part inside the window and inside every
   * ancestor that clips its content (scroll views, `overflow: hidden`). 0 when hidden by style.
   */
  visibleRatio: number;
  /** Platform-independent kind, when the element is one of SEMANTIC_TYPES. */
  semanticType?: SemanticType;
  /** Has the input focus (text inputs; the focused DOM element on the web). */
  focused: boolean;
  /** False when disabled (`disabled`, `accessibilityState.disabled`, `aria-disabled`, `editable={false}`). */
  enabled: boolean;
  /** Checked state of switches, checkboxes and radios (`accessibilityState.checked`, `aria-checked`, Switch `value`). */
  checked?: boolean | 'mixed';
  /** Current value: TextInput text, Switch / Slider / Picker value, or `accessibilityValue`. */
  value?: JsonValue;
  /** Serializable subset of the element's props (functions and React elements are dropped). */
  props: Record<string, JsonValue>;
}

/** Compact element tree for diagnostics (`getTree`). */
export interface TreeNode {
  type: string;
  testID?: string;
  text?: string;
  role?: string;
  semanticType?: SemanticType;
  /** Rounded rect. */
  rect?: Rect;
  children: TreeNode[];
}
