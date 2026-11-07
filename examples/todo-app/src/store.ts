/** Tiny app store (session + todos) shared by the screens and the e2e backdoors. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { Todo } from './api';

export interface Session {
  email: string;
  token: string;
}

interface State {
  session: Session | null;
  todos: Todo[];
}

const SESSION_KEY = 'session';
let state: State = { session: null, todos: [] };
const listeners = new Set<() => void>();

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const store = {
  get: (): State => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  async setSession(session: Session | null): Promise<void> {
    if (session === null) await AsyncStorage.removeItem(SESSION_KEY);
    else await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
    set({ session });
  },
  async restoreSession(): Promise<void> {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    set({ session: raw === null ? null : (JSON.parse(raw) as Session) });
  },
  setTodos: (todos: Todo[]) => set({ todos }),
  prependTodo: (todo: Todo) => set({ todos: [todo, ...state.todos] }),
  clear: () => set({ session: null, todos: [] }),
};

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
