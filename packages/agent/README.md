# @quiesco/agent

The in-app agent of Quiesco: element queries, synchronization trackers (network, timers, React,
animations), actions, soft reset and backdoors. It connects to the test run from inside the e2e build of
your app; without `EXPO_PUBLIC_QUIESCO=1` it is replaced by a no-op stub.

```sh
npm i @quiesco/agent @quiesco/native
```

- `metro.config.js`: `module.exports = withQuiesco(getDefaultConfig(__dirname))` with
  `const { withQuiesco } = require('@quiesco/agent/metro')`.
- Import `@quiesco/agent` first in the entry file and wrap the root in `<QuiescoRoot>`.

`npx quiesco init` sets up Metro and the entry file. In-app API (`quiesco.backdoor`, `quiesco.onReset`, …):
[API reference](https://github.com/h2nology/quiesco/blob/main/docs/api.md).

Peer dependencies: `react` >= 19.2, `react-native` >= 0.83 (New Architecture). Supported: Expo SDK 58.

Part of [Quiesco](https://github.com/h2nology/quiesco): gray-box end-to-end testing for Expo apps on iOS, Android and the web. Setup: `npx quiesco init` ([quick start](https://github.com/h2nology/quiesco#quick-start-web-about-10-minutes)).

## License

MIT
