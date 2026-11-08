/**
 * Test-only backdoors (requirements.md §6.6). Imported only when EXPO_PUBLIC_QUIESCO=1, so neither this
 * code nor the test API calls reach production bundles (docs/spikes/06, approach A).
 */
import { quiesco } from '@quiesco/agent';

import { api, setApiBase } from './api';
import { store } from './store';

// Parallel test workers each run their own mock backend on 3001 + worker index
// (features/support/mock-server.ts); the index arrives with the host connection.
setApiBase(() => `http://localhost:${3001 + (quiesco.workerIndex() ?? 0)}`);

quiesco.backdoor('loginAs', async (email: string) => {
  const session = await api.login(email, 'e2e-password');
  await store.setSession(session);
});

quiesco.backdoor('seedTodos', async (titles: string[]) => {
  store.setTodos(await api.replaceTodos(titles));
});

quiesco.onReset(async () => {
  await api.replaceTodos([]);
  store.clear();
});
