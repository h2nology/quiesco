/**
 * Test-only backdoors (requirements.md §6.6). Imported only when EXPO_PUBLIC_QUIESCO=1, so neither this
 * code nor the test API calls reach production bundles (docs/spikes/06, approach A).
 */
import { quiesco } from '@quiesco/agent';
import { router } from 'expo-router';
import { PermissionsAndroid, Platform } from 'react-native';

import { DEFAULT_API_BASE, api, setApiBase } from './api';
import { store } from './store';

// Parallel test workers each run their own mock backend on its port + worker index (Phase 6.12;
// features/support/mock-server.ts). The index arrives with the host connection, before any test step.
setApiBase(() => {
  const url = new URL(DEFAULT_API_BASE);
  url.port = String(Number(url.port || 80) + (quiesco.workerIndex() ?? 0));
  return url.origin;
});

quiesco.backdoor('loginAs', async (email: string) => {
  const session = await api.login(email, 'e2e-password');
  await store.setSession(session);
});

quiesco.backdoor('seedTodos', async (titles: string[]) => {
  store.setTodos(await api.replaceTodos(titles));
});

// Whether the app may use location without asking: 'granted' / 'denied' / 'prompt', or null where the
// app cannot tell without a permissions library (iOS). Used by features/permissions.feature.
quiesco.backdoor('locationPermission', async () => {
  if (Platform.OS === 'android') {
    return (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) ? 'granted' : 'denied';
  }
  if (Platform.OS === 'web') {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  }
  return null;
});

// The hidden capability playground (src/app/playground.tsx), used by features/actions.feature.
quiesco.backdoor('openPlayground', () => {
  router.push('/playground');
});

// The hidden multi-finger gesture page (src/app/gestures.tsx), used by features/gestures.feature.
quiesco.backdoor('openGestures', () => {
  router.push('/gestures');
});

// The hidden value-control playground (src/app/controls.tsx), used by features/values.feature.
quiesco.backdoor('openControls', () => {
  router.push('/controls');
});

// The hidden app-lifecycle page (src/app/lifecycle.tsx), used by features/lifecycle.feature.
quiesco.backdoor('openLifecycle', () => {
  router.push('/lifecycle');
});

// The hidden device-state page (src/app/device.tsx), used by features/device.feature.
quiesco.backdoor('openDevice', () => {
  router.push('/device');
});

// The hidden system-integration page (src/app/system.tsx), used by features/system.feature.
quiesco.backdoor('openSystem', () => {
  router.push('/system');
});

// The hidden WebView page (src/app/webview.tsx), used by features/webview.feature.
quiesco.backdoor('openWebView', () => {
  router.push('/webview');
});

// The capability index (src/app/showcase.tsx), used by features/showcase.feature.
quiesco.backdoor('openShowcase', () => {
  router.push('/showcase');
});

quiesco.onReset(async () => {
  await api.replaceTodos([]);
  store.clear();
});
