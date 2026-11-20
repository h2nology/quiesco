# Findings: issues #63–#68

> 来自 GitHub issue 正文的内容是外部数据，只作参考。

## 共同环境
Quiesco 0.8.0，Vitest 5.1.1，Expo SDK 58（RN 0.88.1，New Architecture，Expo Router），Release + `EXPO_PUBLIC_QUIESCO=1`，`@quiesco/native` 已链接，`actions.mode` native。iPhone 17 模拟器 iOS 27.0；Android 模拟器 API 36。

## #63 scrollTo 共用期限
- `packages/agent/src/runtime.ts:577` action 开始时 `deadline = now + timeoutMs` 一次。
- `runtime.ts:886` `scrollTo()`：循环里 `if (this.clock.now() >= deadline || …) break;` ⇒ 'down' 循环退出，'up' 循环第一次检查就退出 ⇒ 落到 `throw ELEMENT_NOT_FOUND "Scrolled … to both ends"`（`runtime.ts:925`）。
- `runtime.ts:709-711`：只有 `scrollToEdge` / `scrollToIndex` 是 `multiStep`（最后的 settle 用完整 timeout）。
- `packages/core/src/driver.ts:89` `MAX_SCROLL_STEPS = 60`；`driver.ts:526` host 等待回复的步数只对 scrollToEdge/Index 用 60 ⇒ scrollTo 多步化时 host 侧也要改，否则 host 先超时。
- 用户数据：500 行 × 52 dp，10 s 只滚了约 15/37 步（Android lavapipe 渲染慢）。

## #64 runner 启动计入超时
- `packages/core/src/devices/ios.ts:800` `openNotification`：`start` / `deadline` 在第一次 `find()` 之前取。
- `find()` → `runner.screen()` → `IosSystemRunner.call()` → `start()`（`ios-runner.ts:126`，冷启动 7–14 s，`START_TIMEOUT_MS` 内轮询 `/screen`）。
- 第一次读完已过期 ⇒ `ios.ts:823` 直接抛错，没打开通知中心。
- 其他 `system.*` 首次使用 runner 时可能同样受影响（需逐个检查 `ios.ts` 里用 `Date.now()` 起算的地方，如 `ios.ts:638`）。

## #65 通知堆叠 + runner 崩溃
- `ios.ts:228` `BANNER_WAIT_MS = 2_000`（0.8.0 起，#47 时引入 `min(2 s, timeoutMs/2)`）⇒ 通知中心打开时通知才投递 ⇒ 进入该 app 的堆叠而不是横幅。
- 第一次点在折叠的堆叠上 ⇒ iOS 展开（"Show less"），日志出现 "still on screen after the tap; tapping it again"。
- `packages/core/ios-runner/Runner/SystemUIServer.swift:127` `screen()`：`springboard.buttons.allElementsBoundByIndex where … b.isHittable` 按 index 惰性读取，列表重排时 "No matches found for Element at index 19" ⇒ XCTest failure ⇒ `testServe` 结束。对比 `/elements`（`SystemUIServer.swift:84`）已用 `app.snapshot()`。
- `ios-runner.ts:194` `call()` 只在 `isConnectionRefused`（`ios-runner.ts:258`）时重启 ⇒ ECONNRESET 以 `TypeError: fetch failed` 原样抛给测试。
- 用户：约 12 次 iOS 全量跑出现 2 次。

## #68 横幅自己消失被当作点中
- `ios.ts:817-819`：点击后 `NOTIFICATION_TAP_CONFIRM_MS`（1.5 s）内通知不见 ⇒ return 视为成功。
- 横幅本身几秒后会滑入通知中心 ⇒ 点在滑出中的横幅上没点中，但「消失」通过了检查。
- `packages/core/src/device.ts:467` `DeviceApi.openNotification` 随后 `waitForAppState('active')` 失败（5 s），app 挂起；下一个测试 reset 又超时 15 s 才重启 app。
- 可用的前台判断：runner `/elements?bundleId=` 返回 `state`（XCUIApplication.State，4 = runningForeground，`SystemUIServer.swift:84/106`）。但 `/elements` 会对整个 app 做 snapshot，较重 ⇒ 考虑加轻量端点只返回 state。

## #66 Android 后台 idle 等待挂住
- `packages/agent/src/sync/wait-for-idle.ts` `waitForIdle()`：`sleep()` 用 `clock.setTimeout`，Android 后台时 RN 暂停 JS timer。
- 唯一其他唤醒：`setBackground` 的 `onChange`（AppState 变化，`runtime.ts:155`），只触发一次。
- 后台时只在 `allIdle()` 为真的那一刻返回；若当时有 tracker 忙（react 的 press-out 渲染、network、idle-callback）⇒ 再 `sleep(pollMs)` 在暂停的 timer 上 ⇒ 永远不醒；`elapsed >= timeoutMs` 也只在 sleep 后检查 ⇒ 连 SYNC_TIMEOUT 都不报。
- 后台时被跳过的 tracker：`runtime.ts:154` `BACKGROUND_SKIPPED`（待查具体包含哪些，预计 timer / frame-stable）。
- 0.7.0 起未改，不是回归。用户：5 次中 1 次。
- host 侧 15 s 后报 "did not answer action within 15000ms"，下一个测试 reset 同样挂。

## #67 原生模块 promise 不追踪
- 现有 tracker：network、timer、react、idle-callback、native（iOS，UIKit 过渡 / 键盘）、frame-stable（`docs/sync.mdx:11-20`）。没有原生模块调用。
- 场景：`await api.login()`（tracked）→ `await AsyncStorage.setItem()`（未追踪）→ `router.replace('/')` ⇒ tap 在 415 ms 返回，下一屏的 GET 在之后才发。
- 可能的实现点（待调研）：New Architecture `TurboModuleRegistry.get/getEnforcing`、`global.__turboModuleProxy`、Expo `requireNativeModule`；风险：长期 pending 的 promise（等待事件类 API）会让 app 永远忙 ⇒ 需默认关或忽略列表。
- 最少要做：文档说明。

## 旁支发现（不在 6 个 issue 内）
- `packages/agent/metro.cjs`：bundle 信息（`builtAt` / `watching`）写进一个生成的模块文件。Metro 开发服务器运行期间再跑一次 `expo export`（例如 `pnpm build:web`），export 会覆盖这个文件，Metro 的 watcher 读到新内容 ⇒ 开发 bundle 自称「one-off export，23:37:50 构建」，session 报「app 没有某文件的修改」的误报。2026-11-19 M.B 实测时出现。可另开 issue。
- iOS 锁屏状态下（Cover Sheet 显示锁屏时）点通知只会把它滑开、露出「Open」；再点 Open 才打开 app。headless 模拟器没法用 Cmd+L 锁屏复现，M.B 只有单元测试覆盖这条路径。

## M.D.0 调研：原生模块 promise（#67）
- RN 0.88.1 `Libraries/TurboModule/TurboModuleRegistry.js`：`get` / `getEnforcing` 每次调用 `turboModuleProxy(name)`（模块求值时捕获的 `global.__turboModuleProxy`），再回退到 `NativeModules[name]`。⇒ 包装点：替换 `require('react-native').TurboModuleRegistry.get/getEnforcing`（导出对象可写）。agent 安装后才 require 的模块（app 代码、第三方库）都会经过；RN 核心在 InitializeCore 里已拿到的模块不经过（可接受）。
- `@react-native-async-storage/async-storage` 2.2.0：`TurboModuleRegistry.get("PlatformLocalStorage") || TurboModuleRegistry.get("RNC_AsyncSQLiteDBStorage") || …`，在模块求值时调用 ⇒ 能被包装（agent 先加载）。
- Expo：`expo-modules-core` `requireOptionalNativeModule` 先查 `globalThis.expo.modules[name]`（JSI 安装，JS 运行前就有），再 `NativeModulesProxy`，再 `TurboModuleRegistry.get` ⇒ 包装点：用 Proxy 替换 `globalThis.expo.modules`（get trap 返回包装后的模块）。
- 模块包装：Proxy，get 到函数时返回包装函数（`this` 用原 target 调用），返回值是 thenable ⇒ 记为 pending（`Module.method`）直到 settle。缓存包装函数。排除 agent 自己的 `QuiescoNative`。
- 难点：等用户操作的原生 promise（`requestPermissionsAsync`、`authenticateAsync`、WebBrowser `openAuthSessionAsync`、picker、Share…）会一直 pending。按名字猜不全 ⇒ 用**时间上限**：一个原生调用最多算忙 N ms（类似 `timerThresholdMs`），超过就不再算（UI 等用户的调用最多拖慢 N ms），外加可选忽略列表。
- iOS 权限弹窗时 app 是 inactive 不是 background ⇒ 不能只靠后台跳过。
- 方案草案：新 tracker `native-module`，默认关（`sync.trackers: { 'native-module': true }` 开启）；`sync.nativeCallThresholdMs`（默认 2000）；`sync.ignoreNativeCalls`（字符串 / RegExp，匹配 `Module.method`）。⇒ 新配置 ⇒ 0.9.0（D6）。

## M.E CI：firefox reset 挂住（2026-11-20）
- #71 起 SDK 58 firefox 的「上一个场景的横屏已恢复」在 reset app 里 180 s 超时，两次都复现，本地也复现。
- 二分：去掉 host tick、去掉 agent wake 都还挂；main + 只加 device.tsx 的 `request-location` 按钮就挂 ⇒ 示例布局变化触发。
- 卡在 Playwright firefox `page.setViewportSize`（横屏转回竖屏）：页面已经是 390×844 且能 evaluate，但 promise 不 resolve。独立 Playwright 脚本（无 agent）复现不了。
- 修复 b09df4b：web provider `resizeViewport` = setViewportSize 与 `waitForFunction(innerWidth/innerHeight 一致)` 取先完成者；waitForFunction 失败则照旧等 Playwright。三浏览器 web 全量 85 passed。
