import { defineConfig } from '@quiesco/core';

export default defineConfig({
  apps: {
    ios: {
      bundleId: 'dev.quiesco.tutorial',
      // Simulator build made with EXPO_PUBLIC_QUIESCO=1: `npx quiesco build ios` writes it here.
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/QuiescoTodoTutorial.app',
      // A dev client loading JS from Metro (quiesco test starts it when it is not running).
      devClient: { metroUrl: 'http://localhost:8081' },
    },
    android: {
      package: 'dev.quiesco.tutorial',
      // `npx quiesco build android` writes it here (EXPO_PUBLIC_QUIESCO=1).
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      devClient: { scheme: 'quiescotutorial', metroUrl: 'http://localhost:8081' },
    },
    // Static export made with EXPO_PUBLIC_QUIESCO=1 npx expo export --platform web.
    web: { distDir: 'dist' },
  },
  // Which simulator / emulator to use. Default: the booted one. To let Quiesco boot one, name it
  // (`xcrun simctl list devices`, `emulator -list-avds`).
  // devices: {
  //   ios: { device: 'iPhone 17' },
  //   android: { avd: 'Medium_Phone_API_37.0' },
  // },
});
