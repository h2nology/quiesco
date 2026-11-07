/**
 * One runtime per JS context, kept on globalThis so Fast Refresh re-evaluating modules reuses it
 * (the DevTools hook and the patched globals must not be installed twice).
 */
import { AgentRuntime } from './runtime';

const KEY = '__quiescoRuntime';

export function getRuntime(): AgentRuntime {
  const g = globalThis as unknown as Record<string, AgentRuntime | undefined>;
  let rt = g[KEY];
  if (rt === undefined) {
    rt = new AgentRuntime();
    rt.installEarly();
    g[KEY] = rt;
  }
  return rt;
}
