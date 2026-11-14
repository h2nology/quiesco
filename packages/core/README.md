# @quiesco/core

The host side of Quiesco: WebSocket server, the `Driver` your tests call (`this.app` / `app`), sessions,
and the iOS simulator and Android emulator device providers. Independent of any test runner — the
adapters [`@quiesco/cucumber`](https://github.com/h2nology/quiesco/tree/main/packages/cucumber), [`@quiesco/vitest`](https://github.com/h2nology/quiesco/tree/main/packages/vitest)
and [`@quiesco/jest`](https://github.com/h2nology/quiesco/tree/main/packages/jest) build on it; use it directly for another runner
([using Quiesco without Cucumber](https://shift-14cc7601.mintlify.site/api#using-quiesco-without-cucumber)).

```sh
npm i -D @quiesco/core
```

Driver API, matchers and configuration: [API reference](https://shift-14cc7601.mintlify.site/api). Platform notes:
[platforms](https://shift-14cc7601.mintlify.site/platforms).

Part of [Quiesco](https://github.com/h2nology/quiesco): gray-box end-to-end testing for Expo apps on iOS, Android and the web. Setup: `npx quiesco init` ([quick start](https://github.com/h2nology/quiesco#quick-start-web-about-10-minutes)).

## License

MIT
