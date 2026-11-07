import type { LogLevel } from './events.js';
import type { TextMatch } from './matcher.js';

export type TrackerName = 'network' | 'timer' | 'react' | 'idle-callback' | 'frame-stable';

/**
 * Agent-side settings derived from `quiesco.config.ts` (requirements.md §6.2, §6.13).
 * Sent by the host in the `hello` result, so trackers installed at app start can be configured later.
 */
export interface AgentConfig {
  sync: {
    timeoutMs: number;
    timerThresholdMs: number;
    countIntervals: boolean;
    stableFrames: number;
    /** URL patterns ignored by the network tracker. Strings match as substrings. */
    ignoreUrls: TextMatch[];
    /** Per-tracker switch; omitted trackers are enabled. */
    trackers: Partial<Record<TrackerName, boolean>>;
  };
  /** Minimum console level forwarded as `log` events; `off` disables forwarding. */
  logLevel: LogLevel | 'off';
}
