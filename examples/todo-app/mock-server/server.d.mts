export function startMockServer(options?: { port?: number; delayMs?: number }): Promise<{ port: number; delayMs: number; close(): Promise<unknown> }>;
