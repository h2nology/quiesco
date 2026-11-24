/**
 * The todos, kept in memory. The screens subscribe with useTodos(); nothing is persisted, so a fresh
 * launch starts with an empty list.
 */
import { useSyncExternalStore } from 'react';

export interface Todo {
  id: string;
  title: string;
  notes: string;
  done: boolean;
}

let todos: Todo[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function set(next: Todo[]): void {
  todos = next;
  for (const listener of listeners) listener();
}

export const todoStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  all: (): Todo[] => todos,
  get: (id: string): Todo | undefined => todos.find((t) => t.id === id),
  /** Adds a todo at the top of the list. */
  add(title: string, notes = ''): Todo {
    const todo: Todo = { id: String(nextId++), title, notes, done: false };
    set([todo, ...todos]);
    return todo;
  },
  toggle(id: string): void {
    set(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  },
  remove(id: string): void {
    set(todos.filter((t) => t.id !== id));
  },
  /** Replaces every todo; the first item is shown at the top. */
  replaceAll(items: readonly { title: string; notes?: string; done?: boolean }[]): void {
    set(items.map((item) => ({ id: String(nextId++), title: item.title, notes: item.notes ?? '', done: item.done ?? false })));
  },
};

export function useTodos(): Todo[] {
  return useSyncExternalStore(todoStore.subscribe, todoStore.all, todoStore.all);
}

export function useTodo(id: string): Todo | undefined {
  return useSyncExternalStore(todoStore.subscribe, () => todoStore.get(id), () => todoStore.get(id));
}
