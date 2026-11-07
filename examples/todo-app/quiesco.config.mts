import { defineConfig } from '@quiesco/core';

export default defineConfig({
  apps: {
    android: {
      package: 'dev.quiesco.todo',
      // Built by `pnpm build:android`; installed before the run.
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      // A dev client loading JS from Metro (`pnpm start:e2e`, port 8082).
      devClient: { scheme: 'quiescotodo', metroUrl: 'http://localhost:8082' },
      // The mock backend (mock-server/server.mjs) on the host's localhost.
      reversePorts: [3001],
    },
  },
  devices: {
    // Which emulator to use comes from the environment, never from this file.
    android: process.env['QUIESCO_AVD'] !== undefined ? { avd: process.env['QUIESCO_AVD'] } : {},
  },
  // Phase 1: no @quiesco/native yet, so actions call the components' callbacks.
  actions: { mode: 'js' },
});
