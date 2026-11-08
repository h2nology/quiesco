/** Client of the local mock server (mock-server/server.mjs). */
export interface Todo {
  id: string;
  title: string;
}

// Android reaches the host's localhost through `adb reverse` (apps.android.reversePorts in quiesco.config.ts).
const DEFAULT_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';
let resolveBase: () => string = () => DEFAULT_BASE;

/** Test builds point each parallel test worker at its own mock backend (src/e2e.ts). */
export function setApiBase(resolver: () => string): void {
  resolveBase = resolver;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${resolveBase()}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  login: (email: string, password: string) => request<{ email: string; token: string }>('POST', '/login', { email, password }),
  listTodos: () => request<Todo[]>('GET', '/todos'),
  createTodo: (title: string) => request<Todo>('POST', '/todos', { title }),
  /** Replace the whole list (titles in display order). */
  replaceTodos: (titles: string[]) => request<Todo[]>('PUT', '/todos', { titles }),
};
