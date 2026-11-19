/** Notifications sent by the agent (no `id`, no response). requirements.md §7. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AgentEvents {
  /** App-side console output forwarded to the host (level is configurable). */
  log: { level: LogLevel; message: string; timestamp: number };
  /** Uncaught exception / red box / unhandled rejection: the current step must fail immediately. */
  error: { kind: 'uncaught' | 'unhandledRejection' | 'redbox'; message: string; stack?: string; timestamp: number };
}

export type AgentEventName = keyof AgentEvents;

/**
 * Notification the host sends while a call to the agent is pending, every HOST_TICK_MS (issue #66). It
 * carries nothing: any incoming message makes the agent check a pending wait for idle again. On Android
 * React Native pauses JS timers while the app is in the background (a system dialog is up), so a wait
 * sleeping on a timer would neither end nor time out. Agents that do not know it ignore it.
 */
export const HOST_TICK = 'tick';
export const HOST_TICK_MS = 500;
