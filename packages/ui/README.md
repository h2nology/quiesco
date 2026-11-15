# @quiesco/ui

The test UI behind `quiesco ui`: run tests from the browser and watch them live — the test tree, run all /
a file / a test with a click, progress per device, failures with Quiesco's evidence (screenshot with the
asserted element outlined, element tree, idle state, logs), console output and the test's source. In
English, 简体中文 and 日本語, dark or light.

```sh
npm i -D @quiesco/ui
npx quiesco ui --platform web
```

The CLI loads this package; it is not used directly. Works with cucumber-js, Vitest (add `quiescoPlugin()`
from `@quiesco/vitest/config`) and Jest (the `@quiesco/jest` preset). Served on 127.0.0.1 only, behind a
token. Details: [test UI](https://shift-14cc7601.mintlify.site/ui).

Part of [Quiesco](https://github.com/h2nology/quiesco): gray-box end-to-end testing for Expo apps on iOS, Android and the web. Setup: `npx quiesco init` ([quick start](https://github.com/h2nology/quiesco#quick-start-web-about-10-minutes)).

## License

MIT
