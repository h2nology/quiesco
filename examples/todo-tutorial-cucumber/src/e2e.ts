/**
 * Test-only code. src/app/_layout.tsx imports this file only when EXPO_PUBLIC_QUIESCO=1, so neither the
 * backdoors nor the reset hook are in production bundles.
 */
import { quiesco } from '@quiesco/agent';

import type {} from './backdoors';
import { todoStore } from './store';

// Lets a test start with todos already in the list, without typing them through the UI.
quiesco.backdoor('seedTodos', (todos) => {
  todoStore.replaceAll(todos);
});

// Quiesco soft-resets the app before every test: storage is cleared and the app is remounted. The todos
// live in a module variable, which a remount keeps, so clear them here.
quiesco.onReset(() => {
  todoStore.replaceAll([]);
});
