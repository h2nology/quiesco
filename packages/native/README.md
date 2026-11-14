# @quiesco/native

Expo module for Quiesco: real touches and text input on iOS and Android. Linked only into e2e builds
(`EXPO_PUBLIC_QUIESCO=1` at `expo prebuild`) by [`@quiesco/expo-plugin`](https://github.com/h2nology/quiesco/tree/main/packages/expo-plugin);
production builds do not contain it.

```sh
npm i @quiesco/agent @quiesco/native
```

You do not call it yourself: `@quiesco/agent` uses it when it is present and falls back to JS
callbacks (`js` input mode) when it is not.

Part of [Quiesco](https://github.com/h2nology/quiesco): gray-box end-to-end testing for Expo apps on iOS, Android and the web. Setup: `npx quiesco init` ([quick start](https://github.com/h2nology/quiesco#quick-start-web-about-10-minutes)).

## License

MIT
