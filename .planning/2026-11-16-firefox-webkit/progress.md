# Progress: Web 端 Firefox / WebKit

## 2026-11-16
- 盘点暂缓工作时 HU 指出 Firefox 未支持；确认现状：provider 可配 firefox / webkit，但从未实跑，doctor / init / 文档只写 Chromium。
- 示例配置加 `QUIESCO_BROWSER`（未提交）；`npx playwright install firefox webkit`；`pnpm build`、`pnpm build:web`。
- Chromium 基线 79 / 13（与之前相同）。
- Firefox、WebKit 默认配置：bail 触发，大量跳过。关闭 bail（临时改配置，已还原）重跑：Firefox 73 / 6 失败，WebKit 67 / 12 失败。
- 桌面视口三个浏览器对照：Chromium 74 / 5、Firefox 73 / 6、WebKit 68 / 11 ⇒ WebKit 拖动失效与视口无关。
- 结果与归类写进 findings；HU 同意开计划，待确认 D1–D4。
- HU 确认：D1 先 spike 合成事件；D2 Firefox、WebKit 都正式支持；D3 新增浏览器标签；D4 CI 加两者。F.0 完成，下一步 F.1。
- F.1：开分支 `feat/firefox-webkit`。spike 确认合成 PointerEvent 可驱动 RNGH 多指手势（三浏览器 × 两视口）；WebKit 要用 createTouch / createTouchList。实现 synthetic-touch.ts 与 setOnLineInPage；provider.test +4（Firefox / WebKit）；`pnpm check` 893 通过。
- 实跑：Firefox 全量 79 / 13 / 0 失败；WebKit 73 / 13 / 6 失败（撤销定位、剪贴板 ×2、拖动排序、快速滑动、滑块）；Chromium 回归 79 / 13。F.1 完成，未提交。下一步 F.2。
- F.2：WebKit 拖动根因是 move 步一口气发完、松开时 App 没跟上；web drag 改为按时长推进 + 终点停 100 ms。测试 +3（反向验证）；pnpm check 896；WebKit 拖动场景 5 次全过；全量 Chromium 79 / 13，WebKit 75 / 13 / 4 失败（F.3）。
