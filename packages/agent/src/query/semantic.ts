/**
 * Platform-independent element kinds and states (Phase 6.1).
 *
 * The semantic type comes from, in order:
 * 1. the accessibility role (`accessibilityRole` / `role`), which the app states explicitly;
 * 2. a scroll host rendered by a virtualized list (its owner has a `renderItem` prop) → `list`;
 * 3. the host component type (`RCTText`, `AndroidSwitch`, `input`, ...). Host type strings are not
 *    minified, so this works in release builds;
 * 4. the display name of a component rendering the host (`Pressable`, `TouchableOpacity`, ...);
 *    only components with an explicit displayName are reliable in release builds;
 * 5. a host whose owner has an `onPress` handler → `button`.
 *
 * Host names are React Native 0.88's (findings.md "6.1 源码确认") plus common community components.
 *
 * Widgets made of several hosts: a host rendered directly by its parent host's component
 * (`renderedWithParent`) with the same semantic type as the parent is a PART of the parent widget,
 * e.g. react-native-web's Switch = root `<div>` (testID, typed via the Switch displayName) + an
 * `<input role="switch">` holding `checked` / `disabled`. Parts do not match `type` on their own,
 * and the widget reads its state (checked, value, enabled, focus) from its parts.
 */
import type { JsonValue, SemanticType } from '@quiesco/protocol';

import type { HostNode } from '../fiber-adapter';

const ROLES: Readonly<Record<string, SemanticType>> = {
  button: 'button',
  togglebutton: 'button',
  imagebutton: 'button',
  link: 'link',
  header: 'header',
  heading: 'header',
  text: 'text',
  image: 'image',
  img: 'image',
  switch: 'switch',
  checkbox: 'checkbox',
  radio: 'radio',
  adjustable: 'slider',
  slider: 'slider',
  search: 'input',
  searchbox: 'input',
  textbox: 'input',
  progressbar: 'progress',
  combobox: 'picker',
  spinbutton: 'picker',
  list: 'list',
};

const HOSTS: Readonly<Record<string, SemanticType>> = {
  // React Native 0.88
  RCTText: 'text',
  RCTVirtualText: 'text',
  RCTSelectableText: 'text',
  RCTSinglelineTextInputView: 'input',
  RCTMultilineTextInputView: 'input',
  AndroidTextInput: 'input',
  RCTImageView: 'image',
  Switch: 'switch',
  RCTSwitch: 'switch',
  AndroidSwitch: 'switch',
  ActivityIndicatorView: 'progress',
  AndroidProgressBar: 'progress',
  RCTScrollView: 'scroll',
  AndroidHorizontalScrollView: 'scroll',
  // Community components
  RNCSlider: 'slider',
  RNCPicker: 'picker',
  RNCAndroidDialogPicker: 'picker',
  RNCAndroidDropdownPicker: 'picker',
  RNDateTimePicker: 'picker',
  ExpoImage: 'image',
  // DOM (react-native-web)
  textarea: 'input',
  img: 'image',
  select: 'picker',
  a: 'link',
  button: 'button',
  progress: 'progress',
  h1: 'header',
  h2: 'header',
  h3: 'header',
  h4: 'header',
  h5: 'header',
  h6: 'header',
};

const DOM_INPUT_TYPES: Readonly<Record<string, SemanticType>> = {
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
};

/** Components with an explicit displayName (or stable name) that identify the element's kind. */
const OWNERS: Readonly<Record<string, SemanticType>> = {
  Text: 'text',
  TextInput: 'input',
  Image: 'image',
  ImageBackground: 'image',
  ScrollView: 'scroll',
  ActivityIndicator: 'progress',
  Switch: 'switch',
  Slider: 'slider',
  Picker: 'picker',
  Checkbox: 'checkbox',
  CheckBox: 'checkbox',
  Pressable: 'button',
  TouchableOpacity: 'button',
  TouchableHighlight: 'button',
  TouchableNativeFeedback: 'button',
  Button: 'button',
};

function isFunction(v: unknown): boolean {
  return typeof v === 'function';
}

export function semanticType(node: HostNode): SemanticType | undefined {
  if (node.role !== undefined) {
    const r = ROLES[node.role.toLowerCase()];
    if (r !== undefined) return r;
  }
  const host = node.type === 'input' ? (DOM_INPUT_TYPES[String(node.props['type'] ?? '')] ?? 'input') : HOSTS[node.type];
  const owner = node.ownerProps();
  if ((host === 'scroll' || node.clipsContent) && isFunction(owner['renderItem'])) return 'list';
  if (host !== undefined) return host;
  for (const name of node.ownerNames()) {
    const o = OWNERS[name];
    if (o !== undefined) return o;
  }
  return isFunction(owner['onPress']) ? 'button' : undefined;
}

/** Whether `node` is a part of its parent's widget (see the module comment). */
export function isWidgetPart(node: HostNode, type: SemanticType | undefined = semanticType(node)): boolean {
  return type !== undefined && node.renderedWithParent && node.parent !== null && semanticType(node.parent) === type;
}

/** The parts of `node`'s widget (direct children rendered with it, of the same semantic type). */
export function widgetParts(node: HostNode, type: SemanticType | undefined = semanticType(node)): HostNode[] {
  if (type === undefined) return [];
  return node.children.filter((c) => c.renderedWithParent && semanticType(c) === type);
}

/** Whether `type` (from a matcher) names this element: semantic type, host type or a component name. */
export function matchesType(node: HostNode, type: string): boolean {
  if (node.type === type || node.ownerNames().includes(type)) return true;
  const kind = semanticType(node);
  return kind === type && !isWidgetPart(node, kind);
}

/** The element's accessibility label, or its widget part's (RNW puts a Switch's aria-label on the inner input). */
export function widgetLabel(node: HostNode): string | undefined {
  if (node.label !== undefined) return node.label;
  for (const part of widgetParts(node)) if (part.label !== undefined) return part.label;
  return undefined;
}

/** Focused, or one of its widget parts is (the focusable `<input>` of a web Switch). */
export function isFocusedWidget(node: HostNode): boolean {
  return node.isFocused() || widgetParts(node).some((p) => p.isFocused());
}

/** Props as the app wrote them: host props first, then the owning composites (Pressable `disabled`, ...). */
function propOf(node: HostNode, name: string): unknown {
  const own = node.props[name];
  return own !== undefined ? own : node.ownerProps()[name];
}

function accessibilityState(node: HostNode): Record<string, unknown> {
  const s = propOf(node, 'accessibilityState');
  return typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : {};
}

function isTrue(v: unknown): boolean {
  return v === true || v === 'true';
}

function selfDisabled(node: HostNode): boolean {
  return (
    isTrue(propOf(node, 'disabled')) ||
    isTrue(accessibilityState(node)['disabled']) ||
    isTrue(propOf(node, 'aria-disabled')) ||
    propOf(node, 'editable') === false
  );
}

/**
 * False when the element, an ancestor (a disabled Pressable disables its label too) or one of its
 * widget parts is disabled.
 */
export function isEnabled(node: HostNode): boolean {
  for (let n: HostNode | null = node; n !== null; n = n.parent) if (selfDisabled(n)) return false;
  return !widgetParts(node).some(selfDisabled);
}

function toChecked(v: unknown): boolean | 'mixed' | undefined {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  if (v === 'mixed') return 'mixed';
  return undefined;
}

/** Checked state: accessibilityState / aria-checked, a DOM checkbox, a Switch's `value`, or a widget part's. */
export function checkedState(node: HostNode, type: SemanticType | undefined = semanticType(node)): boolean | 'mixed' | undefined {
  const own = ownChecked(node, type);
  if (own !== undefined) return own;
  for (const part of widgetParts(node, type)) {
    const c = ownChecked(part, type);
    if (c !== undefined) return c;
  }
  return undefined;
}

function ownChecked(node: HostNode, type: SemanticType | undefined): boolean | 'mixed' | undefined {
  const fromA11y = toChecked(accessibilityState(node)['checked']) ?? toChecked(propOf(node, 'aria-checked'));
  if (fromA11y !== undefined) return fromA11y;
  if (type === 'switch' || type === 'checkbox' || type === 'radio') {
    return toChecked(propOf(node, 'checked')) ?? toChecked(propOf(node, 'value'));
  }
  return undefined;
}

function jsonScalar(v: unknown): JsonValue | undefined {
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

/** The element's value: input text, switch state, slider / picker value, accessibilityValue, or a widget part's. */
export function elementValue(node: HostNode, type: SemanticType | undefined = semanticType(node)): JsonValue | undefined {
  const own = ownValue(node, type);
  if (own !== undefined) return own;
  for (const part of widgetParts(node, type)) {
    const v = ownValue(part, type);
    if (v !== undefined) return v;
  }
  return undefined;
}

function ownValue(node: HostNode, type: SemanticType | undefined): JsonValue | undefined {
  const text = node.inputValue();
  if (text !== undefined) return text;
  if (type === 'switch' || type === 'checkbox' || type === 'radio') {
    const c = ownChecked(node, type);
    if (typeof c === 'boolean') return c;
  }
  if (type === 'picker') {
    const v = jsonScalar(propOf(node, 'selectedValue')) ?? jsonScalar(propOf(node, 'value'));
    if (v !== undefined) return v;
  }
  if (type === 'slider' || type === 'progress') {
    const v = jsonScalar(propOf(node, 'value'));
    if (v !== undefined) return v;
  }
  const a11y = propOf(node, 'accessibilityValue');
  if (typeof a11y === 'object' && a11y !== null) {
    const o = a11y as Record<string, unknown>;
    const v = jsonScalar(o['text']) ?? jsonScalar(o['now']);
    if (v !== undefined) return v;
  }
  return jsonScalar(propOf(node, 'aria-valuetext')) ?? jsonScalar(propOf(node, 'aria-valuenow'));
}
