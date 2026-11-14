/**
 * Expo Router's navigation container ref, when the app uses Expo Router (issue #1). Optional: Metro treats a
 * `require` directly inside a `try` block as an optional dependency (transformer.allowOptionalDependencies,
 * on by default), so apps without expo-router still bundle. Loaded on QuiescoRoot's first render, not at
 * import time: `@quiesco/agent` is imported before `expo-router/entry`.
 */
import type { NavigationRef } from './index';

declare const require: (id: string) => unknown;

type UseRef = () => NavigationRef | null;

const none: UseRef = () => null;
let hook: UseRef | undefined;

/**
 * A hook returning the container ref (or null). Resolved once, so every render calls the same hooks.
 * `useNavigationContainerRef` is called as a hook, inside QuiescoRoot, which sits inside the container.
 */
export function navigationRefHook(): UseRef {
  if (hook !== undefined) return hook;
  try {
    const mod = require('expo-router') as { useNavigationContainerRef?: () => NavigationRef | null };
    hook = typeof mod.useNavigationContainerRef === 'function' ? mod.useNavigationContainerRef : none;
  } catch {
    hook = none;
  }
  return hook;
}
