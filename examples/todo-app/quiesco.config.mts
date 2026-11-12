import { defineConfig } from '@quiesco/core';
import type { WebViewport } from '@quiesco/core';

// Web viewports under test (requirements.md §11-7: phone, tablet and desktop are all accepted).
// Pick one with QUIESCO_VIEWPORT; the default is the phone layout.
const viewports: Record<string, WebViewport> = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  tablet: { width: 820, height: 1180, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  desktop: { width: 1280, height: 800 },
};
const viewportName = process.env['QUIESCO_VIEWPORT'] ?? 'mobile';
// Metro serving the dev clients (`pnpm start:e2e`, port 8082); QUIESCO_METRO_URL points at another one.
const metroUrl = process.env['QUIESCO_METRO_URL'] ?? 'http://localhost:8082';
const viewport = viewports[viewportName];
if (viewport === undefined) throw new Error(`Unknown QUIESCO_VIEWPORT "${viewportName}" (${Object.keys(viewports).join(', ')})`);

// Evaluated once per test worker (Phase 6.12): worker N talks to its own mock backend on MOCK_PORT + N.
const mockPort = Number(process.env['MOCK_PORT'] ?? 3001);

export default defineConfig(({ workerIndex }) => ({
  apps: {
    android: {
      package: 'dev.quiesco.todo',
      // Built by `pnpm build:android`; installed before the run.
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      // A dev client loading JS from Metro (`pnpm start:e2e`, port 8082).
      devClient: { scheme: 'quiescotodo', metroUrl },
      // This worker's mock backend (mock-server/server.mjs) on the host's localhost; MOCK_PORT moves it (the
      // app then needs EXPO_PUBLIC_API_URL=http://localhost:<port> when bundling).
      reversePorts: [mockPort + workerIndex],
    },
    ios: {
      bundleId: 'dev.quiesco.todo',
      // Built by `pnpm build:ios` (simulator, Debug); installed before the run.
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/QuiescoTodo.app',
      // The simulator shares the Mac's network: Metro and the mock backend are on localhost as is.
      devClient: { metroUrl },
    },
    // Static export (`pnpm build:web`), or a running dev server with QUIESCO_WEB_URL.
    web: process.env['QUIESCO_WEB_URL'] !== undefined ? { url: process.env['QUIESCO_WEB_URL'] } : { distDir: 'dist' },
  },
  devices: {
    // Which emulator to use comes from the environment, never from this file. In parallel runs worker N > 0
    // uses an AVD of its own, "<QUIESCO_AVD>_quiesco_N", created from it on first use.
    android: process.env['QUIESCO_AVD'] !== undefined ? { avd: process.env['QUIESCO_AVD'] } : {},
    // Default: the booted simulator. QUIESCO_IOS_DEVICE (e.g. "iPhone 17") and QUIESCO_IOS_OS (e.g. "27.0") pick one.
    // In parallel runs worker N > 0 uses "<that simulator> (Quiesco N)", created on first use.
    ios: {
      ...(process.env['QUIESCO_IOS_DEVICE'] !== undefined ? { device: process.env['QUIESCO_IOS_DEVICE'] } : {}),
      ...(process.env['QUIESCO_IOS_OS'] !== undefined ? { os: process.env['QUIESCO_IOS_OS'] } : {}),
    },
    web: { browser: 'chromium', viewport },
  },
  // Granted before the app starts, so no system dialog interrupts a scenario (features/permissions.feature).
  // Location is the one permission every platform can pre-grant (camera / notifications cannot be on the
  // iOS simulator: simctl privacy has no such service).
  permissions: ['location'],
  // actions.mode is not set: `native` (real touches) when the app has @quiesco/native, else `js`.
  // Run with QUIESCO_ACTION_MODE=js to force callback mode.
  ...(process.env['QUIESCO_ACTION_MODE'] === 'js' ? { actions: { mode: 'js' as const } } : {}),
}));
