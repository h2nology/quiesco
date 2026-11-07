/** Notifications sent by the agent (no `id`, no response). requirements.md §7. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AgentEvents {
  /** App-side console output forwarded to the host (level is configurable). */
  log: { level: LogLevel; message: string; timestamp: number };
  /** Uncaught exception / red box / unhandled rejection: the current step must fail immediately. */
  error: { kind: 'uncaught' | 'unhandledRejection' | 'redbox'; message: string; stack?: string; timestamp: number };
}

export type AgentEventName = keyof AgentEvents;
