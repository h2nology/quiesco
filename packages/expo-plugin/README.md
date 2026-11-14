# @quiesco/expo-plugin

Expo config plugin for Quiesco. In e2e builds (`EXPO_PUBLIC_QUIESCO=1` at `expo prebuild`) it links
[`@quiesco/native`](https://github.com/h2nology/quiesco/tree/main/packages/native) and allows the local connection to the test run; in
production builds it excludes the native module.

```sh
npm i -D @quiesco/expo-plugin
```

```json
{ "expo": { "plugins": ["@quiesco/expo-plugin"] } }
```

Part of [Quiesco](https://github.com/h2nology/quiesco): gray-box end-to-end testing for Expo apps on iOS, Android and the web. Setup: `npx quiesco init` ([quick start](https://github.com/h2nology/quiesco#quick-start-web-about-10-minutes)).

## License

MIT
