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
- F.3（2026-11-17）：WebKit 定位权限变化时重启 App；剪贴板由 Quiesco 保存（clipboard-store.ts）；移动端 WebKit 用合成 WheelEvent。测试 +3；pnpm check 899。全量：手机视口三浏览器 79 / 13 / 0；桌面视口（not @multi-touch）三者 74 / 12 / 0。下一步 F.4。
- F.4：浏览器标签（core tags + Lifecycle 取 devices.web.browser）；示例 cucumber.mjs 按视口 / 档位自动排除 @multi-touch / @needs-touch；doctor 与安装提示按配置的浏览器；文档三语 + plugin references。pnpm check 902；docs:check ok；WebKit 桌面视口全量 74 / 12 / 0。下一步 F.5。
