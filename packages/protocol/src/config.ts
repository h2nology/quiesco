import type { LogLevel } from './events.js';
import type { Matcher, TextMatch } from './matcher.js';

export const TRACKER_NAMES = ['network', 'timer', 'react', 'idle-callback', 'frame-stable', 'native'] as const;
export type TrackerName = (typeof TRACKER_NAMES)[number];

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
    /**
     * Elements (and their subtrees) left out of the frame-stable check, e.g. a decorative animation that
     * runs for minutes. Optional for older hosts.
     */
    ignoreElements?: Matcher[];
  };
  /** Minimum console level forwarded as `log` events; `off` disables forwarding. */
  logLevel: LogLevel | 'off';
  /**
   * How far fingers move before the platform's gesture recognizers activate (they measure from there):
   * pinch / rotate move this much first, so the app sees the requested scale / angle (Phase 6.4).
   * Logical units and radians. Optional for older hosts (no compensation).
   */
  gestures?: GestureSlop;
}

export interface GestureSlop {
  /** Change of the distance between two fingers before a pinch recognizer activates. */
  pinch: number;
  /** Rotation before a rotation recognizer activates, in radians. */
  rotation: number;
}
