<!-- Generated from docs/eas.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# EAS

Build the e2e app with EAS Build and run the tests on Expo's workers with EAS Workflows.
EAS can do both halves of a native test run: [EAS Build](https://docs.expo.dev/build/introduction/) makes the
e2e build of the app, and [EAS Workflows](https://docs.expo.dev/eas/workflows/get-started/) runs `quiesco test`
against it, on a macOS worker with an iOS simulator and on a Linux worker with an Android emulator. No Mac
or emulator of your own is needed.

The setup below runs the tutorial app's tests ([examples/todo-tutorial-vitest](https://github.com/h2nology/quiesco/tree/main/examples/todo-tutorial-vitest))
on both platforms. It needs the EAS CLI (`npm install -g eas-cli`), an Expo account (`eas login`) and the
project linked to it (`eas init`).

## The build profile {#build-profile}

Add an `e2e` profile to `eas.json`:

```json eas.json
{
  "build": {
    "e2e": {
      "withoutCredentials": true,
      "env": { "EXPO_PUBLIC_QUIESCO": "1" },
      "ios": { "simulator": true },
      "android": { "buildType": "apk" }
    }
  }
}
```

- `EXPO_PUBLIC_QUIESCO=1` is what `quiesco build` sets locally: the agent stays in the JS bundle and
  `@quiesco/expo-plugin` links `@quiesco/native` and allows the connection to the test host. Without it the
  build is a production build and Quiesco cannot connect to the app.
- `ios.simulator` makes a simulator build (`.app`), `android.buildType: "apk"` an APK that can be installed
  on an emulator. Neither needs signing credentials (`withoutCredentials`).
- The profile has no `developmentClient`: the JS is bundled into the app, so the run needs no Metro.

## The config {#config}

The local setup launches a dev client that loads its JS from Metro; the EAS build is a standalone app.
EAS sets `EAS_BUILD` on its workers, so `quiesco.config.mts` can tell the two apart:

```ts quiesco.config.mts
import { defineConfig } from '@quiesco/core';

// On EAS workers: the `e2e` build, which the workflow puts in build/.
const onEas = process.env['EAS_BUILD'] !== undefined;

export default defineConfig({
  apps: {
    ios: onEas
      ? { bundleId: 'dev.quiesco.tutorial', binaryPath: 'build/e2e-ios.app' }
      : {
          bundleId: 'dev.quiesco.tutorial',
          binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/QuiescoTodoTutorial.app',
          devClient: { metroUrl: 'http://localhost:8081' },
        },
    android: onEas
      ? { package: 'dev.quiesco.tutorial', binaryPath: 'build/e2e-android.apk' }
      : {
          package: 'dev.quiesco.tutorial',
          binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
          devClient: { scheme: 'quiescotutorial', metroUrl: 'http://localhost:8081' },
        },
  },
  // On EAS, Quiesco boots this simulator; the Android emulator is started by the workflow.
  ...(onEas ? { devices: { ios: { device: 'iPhone 17' } } } : {}),
});
```

Without `devClient` Quiesco launches the app directly and starts no Metro. Pick a simulator the worker's
image has (`xcrun simctl list devices available` in a workflow step lists them).

## The workflow {#workflow}

```yaml .eas/workflows/e2e.yml
name: e2e

on:
  pull_request:
    branches: ['*']

jobs:
  build_ios:
    type: build
    params:
      platform: ios
      profile: e2e

  build_android:
    type: build
    params:
      platform: android
      profile: e2e

  test_ios:
    needs: [build_ios]
    runs_on: macos-medium
    steps:
      - uses: eas/checkout
      - uses: eas/install_node_modules
      - uses: eas/download_build
        id: download
        with:
          build_id: ${{ needs.build_ios.outputs.build_id }}
      - name: Run the tests on the iOS simulator
        run: |
          mkdir -p build
          cp -R "${{ steps.download.outputs.artifact_path }}" build/e2e-ios.app
          source "$NVM_DIR/nvm.sh" && nvm install 24
          npx quiesco test --platform ios
      - uses: eas/upload_artifact
        if: ${{ always() }}
        with:
          type: other
          name: quiesco-ios
          path: artifacts
          ignore_error: true

  test_android:
    needs: [build_android]
    runs_on: linux-medium-nested-virtualization
    steps:
      - uses: eas/checkout
      - uses: eas/install_node_modules
      - uses: eas/download_build
        id: download
        with:
          build_id: ${{ needs.build_android.outputs.build_id }}
      - name: Start an Android emulator
        run: |
          echo no | avdmanager create avd -n e2e -d pixel_6 -k 'system-images;android-36;google_apis;x86_64' > /dev/null 2>&1
          nohup emulator -avd e2e -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect > emulator.log 2>&1 &
          adb wait-for-device
          timeout 300 sh -c 'until [ "$(adb shell getprop sys.boot_completed | tr -d "\r")" = 1 ]; do sleep 2; done'
      - name: Run the tests on the emulator
        run: |
          mkdir -p build
          cp "${{ steps.download.outputs.artifact_path }}" build/e2e-android.apk
          source "$NVM_DIR/nvm.sh" && nvm install 24
          npx quiesco test --platform android
      - uses: eas/upload_artifact
        if: ${{ always() }}
        with:
          type: other
          name: quiesco-android
          path: artifacts
          ignore_error: true
```

What each part is for:

- **Workers.** The iOS simulator needs a `macos-*` worker, the Android emulator a
  `linux-*-nested-virtualization` one (the others have no KVM).
- **Node.js 24.** Quiesco needs Node.js 24 or later; the workers' default is older. `nvm install 24` switches
  inside the step that runs Quiesco: each `run` is a shell of its own, so the switch does not carry over to
  the next step. `eas/install_node_modules` can stay on the default Node.
- **The build.** `eas/download_build` unpacks the iOS simulator build (EAS stores it as a `.tar.gz`), so
  `artifact_path` is the `.app` on iOS and the `.apk` on Android. The step copies it to where `binaryPath`
  points.
- **The Android emulator.** Linux workers have no display, so the workflow starts the emulator itself with
  `-no-window` and waits for the boot; Quiesco then uses the running emulator. The worker image has the
  system images under `$ANDROID_HOME/system-images` (Android 30 to 37 at the time of writing). `avdmanager`
  prints `devices.xml` errors on these images; they are harmless, which is why its output is discarded.
- **The iOS simulator.** Quiesco boots the simulator named in `devices.ios` itself. The first test of a job
  takes about a minute and a half longer: the simulator boots, and Quiesco's system UI runner is built once
  for the worker's Xcode.
- **Evidence.** A failing test leaves its screenshot, element tree and logs under `artifacts/`
  ([artifacts](../../quiesco-api/references/api-artifacts.md)); `eas/upload_artifact` attaches them to the job on the EAS dashboard.
  `if: ${{ always() }}` runs it after a failure too, and `ignore_error` keeps a run where every test passed
  (and `artifacts/` was never created) from failing on the upload.

Run it from your machine:

```sh
eas workflow:run .eas/workflows/e2e.yml
```

The `pull_request` trigger runs it on every pull request once the Expo project is linked to the GitHub
repository (project settings on expo.dev). See Expo's [workflow syntax](https://docs.expo.dev/eas/workflows/syntax/)
for other triggers.

## An EAS build on another machine {#download}

The `e2e` build also runs outside EAS, e.g. on your Mac or in another CI:

```sh
eas build --profile e2e --platform ios
eas build:download --build-id <id>       # prints the path of the unpacked .app (or the .apk)
```

Copy the file to where `apps.ios.binaryPath` (or `apps.android.binaryPath`) points and leave `devClient`
out, as in [the config](#config) above.
