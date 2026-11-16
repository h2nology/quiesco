# Findings: Web 端 Firefox / WebKit

## 基线实跑（2026-11-16）
- 环境：Playwright 1.65.0（firefox-1572、webkit-2388），示例 App 静态导出（`pnpm build:web`），cucumber 全量 92 场景；切换浏览器用示例配置里新加的 `QUIESCO_BROWSER`。
- 默认 `bailOnRepeatedFailure: 3` 下，两个浏览器都因连续 3 个手势场景报同一错误而跳过其余 65 个场景（Firefox 23 通过 / 4 失败，WebKit 20 / 7）⇒ 以下结果都是 bail 关闭后的。
- 日志（scratchpad，会被清理）：`firefox-full.log`、`webkit-full.log`、`{chromium,firefox,webkit}-desktop.log`。

| 视口 | Chromium | Firefox | WebKit |
|------|----------|---------|--------|
| 手机（390×844，hasTouch、isMobile） | 79 通过 / 0 失败 | 73 / 6 | 67 / 12 |
| 桌面（1280×800） | 74 / 5 | 73 / 6 | 68 / 11 |

13 个跳过是平台标签，三个浏览器相同。桌面视口下 Chromium 的 5 个失败是双指手势要求触摸视口（`ACTION_NOT_SUPPORTED`，预期行为）。

## 失败明细
| # | 场景 | Firefox | WebKit | 错误 / 原因 |
|---|------|---------|--------|-------------|
| 1 | gestures.feature:9/13/17/21/25（捏合、旋转、双指滑动） | ✗ | ✗ | `browserContext.newCDPSession: CDP session is only available in Chromium`（`packages/web/src/provider.ts:585`，`Input.dispatchTouchEvent`） |
| 2 | device.feature:52 App 感知到离线与恢复 | ✗ | ✗ | `net-state` 仍是 online。断网的 `navigator.onLine` / `navigator.connection` 变化靠 CDP（`provider.ts:390`）；非 Chromium 分支只拦截请求并警告（`provider.ts:385`） |
| 3 | device.feature:36 运行时撤销定位权限 | ✓ | ✗ | 撤销后 App 仍拿到 35.68,139.76。`setPermission` = `clearPermissions()` + 重新授予其余（`provider.ts:339`）；推测 WebKit 对已授权页面不生效，未验证 |
| 4 | device.feature:74 / :79 剪贴板读写 | ✓ | ✗ | `User denied permission to access clipboard` / `NotAllowedError`。`grantPermissions(['clipboard-read','clipboard-write'])` 失败只记 debug（`provider.ts:417`） |
| 5 | showcase.feature:23 长按后拖动列表行排序 | ✓ | ✗ | 顺序没变。两种视口都失败 ⇒ 不是触摸相关。drag = `mouse.down` → 等 holdMs → `mouse.move(steps)` → `mouse.up`（`provider.ts:257`） |
| 6 | values.feature:16 拖动滑块到 75% | ✓ | ✗ | 音量 0。同样走 drag，大概率与 5 同一根因 |
| 7 | showcase.feature:31 快速滑动不拿起行（仅手机视口） | ✓ | ✗ | `mouse.wheel: Mouse wheel is not supported in mobile WebKit`（`provider.ts:269`） |

## 能跑通的（三个浏览器都过）
点击、输入、导航、可见性 / 遮挡、等待同步（网络、动画、定时器）、alert / confirm（`page opened a dialog` 正常处理）、WebView（iframe）、截图证据、生命周期 / 重启、深链接、外观 / 语言、定位模拟（设置坐标）。

## 体验问题
- 非 Chromium 上碰到 CDP 功能时，用户看到的是 Playwright 原始错误，不是 `ACTION_NOT_SUPPORTED` + hint；连续 3 次后又触发 bail，表现为「大部分场景被跳过」，容易误判成整体不可用。
- doctor 只检查 Chromium（`packages/cli/src/commands/doctor.ts:428`），init / quickstart / session 安装提示都只写 `playwright install chromium`。

## F.1 spike：多指手势与断网（2026-11-16）
- Playwright 的 Firefox / WebKit 协议只有单点的 `dispatchTapEvent`，没有多点触摸 ⇒ 只能在页面里合成事件。
- RNGH 3.3 web 只听 PointerEvent（`PointerEventManager`：pointerdown / move / up / cancel），pointerdown 和 pointermove 时对 pointerId 调 `setPointerCapture`。合成的 pointerId 不是活动指针，`setPointerCapture` 会抛 NotFoundError ⇒ 播放期间临时替换 `Element.prototype` 的 set / release / hasPointerCapture，只接管合成 id（记下 capture 元素，后续事件发给它），结束后还原。
- spike 脚本（scratchpad `spike-touch/spike.mjs`，静态托管 dist）：Chromium / Firefox / WebKit × 手机 / 桌面视口，合成 PointerEvent 都能让 pinch / rotate / 双指滑动的结果变化，三个浏览器数值完全相同 ⇒ 机制可用。
- TouchEvent：触摸视口下三者都有 `TouchEvent`；Firefox 桌面视口没有。WebKit 的 `new Touch()` 报 Illegal constructor，要用 `document.createTouch(view, target, id, pageX, pageY, screenX, screenY)` + `document.createTouchList(...)`，WebKit 的 `TouchEventInit` 只接受 TouchList（传数组报 Type error）。
- 事件序列与 CDP 一致：每个按下 / 抬起的手指各一个 touchstart / touchend，移动的手指按 target 合成一个 touchmove；PointerEvent 每个手指各一个。
- NetInfo web（`nativeModule.web.ts`）：有 `navigator.connection` 时听它的 `change`（Chromium），否则听 window `online` / `offline`，读 `navigator.onLine` ⇒ Firefox / WebKit 上在页面里覆盖 `navigator.onLine` 并派发事件即可；恢复时删除覆盖。离线时文档请求本身也被拦截（三个浏览器一样），所以不用处理「离线时重新加载」；离线重启沿用 launch 后再应用。
- 另：示例 feature 里 `@needs-touch` / `@multi-touch` 只是说明性标签，没有配置去排除；桌面视口下双指手势失败（`ACTION_NOT_SUPPORTED`）在 Chromium 上也一样，是之前就有的情况。F.4 加浏览器标签时一并处理（如桌面视口的运行排除 `@multi-touch`）。

## F.2 WebKit 拖动（2026-11-16）
- 直接用 Playwright 拖（spike `spike-drag/`）：三个浏览器都会收到同样的 pointer / mouse 事件序列；WebKit 额外有 `selectstart` / `selectionchange`，但 RN-web 遇到 selectionchange 时会问 `onPanResponderTerminationRequest`，排序页返回 false，选区也是空的 ⇒ 不是原因。
- 拖动中采样被拖行的 transform：Chromium 每次 `mouse.move` 等一帧（38 步约 620 ms），行跟到 104 px；WebKit 38 步在 40 ms 内发完，松开时行只到 85 px（有时更少）。排序页落点 = `round(dy / 52)` ⇒ 少于 78 px 就只移一行，正是失败时的「香蕉、苹果、樱桃…」。600 ms 第一次通过是碰巧。
- 修复：provider 自己按时间推进每一步（`durationMs * k / steps`），终点停 100 ms 再松开。滑块（adjustSlider，300 ms、不长按）同一路径，一并修好。

## F.3 WebKit 的平台限制（2026-11-17）
探测（scratchpad `spike-f3/`，localhost 安全上下文，触摸视口）：

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| clearPermissions 后当前页 getCurrentPosition | 拒绝（code 1），query = prompt | 弹授权（挂起），query = prompt | **仍返回坐标**，query 仍 granted；新开的页面被拒绝 |
| 运行时 grantPermissions 后当前页 | — | — | 仍拒绝（query 变 granted）⇒ 页面一直用第一次的决定 |
| grantPermissions clipboard-* | ok | Unknown permission（但读写都可用） | Unknown permission；writeText ok，**readText NotAllowedError** |
| mouse.wheel（isMobile） | ok | ok | **not supported in mobile WebKit** |
| 合成 WheelEvent 是否滚动 | 否 | 否 | **是** |

- 定位：core 的 `afterChange` / `resetDeviceState` 已支持 provider 返回 `relaunch: true`（Android 撤销时就是这样）⇒ WebKit 上定位权限变化时重启 App（数据保留），新页面按新设置。只验证了 geolocation，其他权限（camera 等）不重启。
- 剪贴板：expo-clipboard web 用 `navigator.clipboard.read()` / `write()`（ClipboardItem），也用 readText / writeText，最后退到 `execCommand('copy')`。WebKit 上无法让真实读取成功 ⇒ 由 Quiesco 保存（context.exposeBinding + addInitScript 覆盖四个方法 + window 的 copy 事件）。限制：只有文本；页面外的系统剪贴板看不到。
- 滚轮：web 的 swipe / scroll 都走 wheel（`packages/agent/src/actions/host.ts:103`）；WebKit 会对合成的 wheel 事件执行滚动 ⇒ 移动端 WebKit 用它代替 `mouse.wheel`。
