/**
 * The app's backdoors by name. The app (src/e2e.ts) and the tests (app.backdoor(...)) both compile this
 * file, so a wrong name or argument is a type error on either side. Types only: nothing reaches the bundle.
 */
export interface SeedTodo {
  title: string;
  notes?: string;
  done?: boolean;
}

declare module '@quiesco/agent' {
  interface Backdoors {
    /** Replaces the list with these todos (the first one at the top). */
    seedTodos: (todos: SeedTodo[]) => void;
  }
}
