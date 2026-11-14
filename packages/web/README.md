# @quiesco/web

The web device provider of Quiesco: runs the web build of your Expo app in Chromium through the
Playwright library. Install it only to test on the web.

```sh
npm i -D @quiesco/web playwright
npx playwright install chromium
```

Quiesco loads it for `npx quiesco test --platform web`. Configuration (`apps.web`):
[API reference](https://github.com/h2nology/quiesco/blob/main/docs/api.mdx#configuration); differences from iOS / Android: [platforms](https://github.com/h2nology/quiesco/blob/main/docs/platforms.mdx).

Part of [Quiesco](https://github.com/h2nology/quiesco): gray-box end-to-end testing for Expo apps on iOS, Android and the web. Setup: `npx quiesco init` ([quick start](https://github.com/h2nology/quiesco#quick-start-web-about-10-minutes)).

## License

MIT
