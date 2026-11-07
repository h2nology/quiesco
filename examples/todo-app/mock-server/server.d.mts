export function startMockServer(options?: { port?: number; delayMs?: number; stall?: string }): Promise<{ port: number; delayMs: number; close(): Promise<unknown> }>;
