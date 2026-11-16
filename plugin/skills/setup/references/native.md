<!-- Generated from docs/native.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# iOS and Android

Build the e2e app and run the same features on an iOS simulator and an Android emulator.
Native runs need an e2e build of the app (made with `EXPO_PUBLIC_QUIESCO=1`, so it contains the agent
and `@quiesco/native`):

```sh
npx expo install expo-dev-client
npx quiesco build ios       # or: npx quiesco build android
npx quiesco test --platform ios
```

`quiesco build` runs `expo prebuild` with `EXPO_PUBLIC_QUIESCO=1` and the native build (`xcodebuild` for the
simulator, `gradlew assembleDebug`), and writes the app where `binaryPath` in `quiesco.config.mts` says (the
generated config has the usual paths). It skips a Debug build when the app config and the dependencies did
not change since the last one; `--force` builds anyway. `quiesco test` starts Metro with
`EXPO_PUBLIC_QUIESCO=1` when the dev client needs it and nothing answers at `devClient.metroUrl`, and stops it
when the run ends; a Metro you started yourself is used as it is (`devServer` in the
[configuration](../../quiesco-api/references/api.md#configuration)).

Set the emulator / simulator in `devices` (see [configuration](../../quiesco-api/references/api.md#configuration)). For CI, an
EAS build profile with `EXPO_PUBLIC_QUIESCO=1` produces the same e2e build; see the
[example app](https://shift-14cc7601.mintlify.site/example-app) for a complete, tested setup on all three platforms.

What differs between the platforms (input, permissions, system dialogs) is in
[platform differences](../../quiesco-api/references/platforms.md).
