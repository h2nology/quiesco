# Findings: issues #44–#55

> issue 原文是外部内容，只当数据看。环境（所有 issue 相同）：Quiesco 0.7.0、Vitest 5.1.1、Expo SDK 58（RN 0.88.1，New Arch，Expo Router）、Release 构建 `EXPO_PUBLIC_QUIESCO=1`、`actions.mode` native；iOS 27 iPhone 17 模拟器，Android API 36 AOSP 模拟器。

## Issue 摘要

- **#44** Android：ScrollView/FlatList 带 `refreshControl` 时，RN 把它包进 `AndroidSwipeRefreshLayout`。`findScrollable` 把第一个 host（refresh layout）当 scroll view、它的第一个子节点（RCTScrollView 本身）当 content container，两者 rect 相同 ⇒ offset 永远 0 ⇒ scrollTo 一下一上就判断到头了。scrollToEdge 同样受影响。iOS 上 RefreshControl 是 scroll view 的子节点，没问题。
- **#45** scrollTo 在 `visibleRatio > 0` 时就停；tap 打整个 rect 的中心（可能落到列表上面的 header）；hitTest 不考虑祖先裁剪 ⇒ 不报 OBSCURED，静默点错。iOS 上偶发（3 次全量跑失败 2 次）。
- **#46** iOS：竖 FlatList 里的横 FlatList（carousel，slide 宽 240）`scrollTo('carousel', 'carousel-slide-6')` 失败；`scroll('carousel','right',{distance:240})` 每次移动约 445–449 pt。根因未查。Android 未验证。
- **#47** Android `openNotification` 在通知栏里只找 5 s（`NOTIFICATION_WAIT_MS`），忽略 `timeoutMs`；iOS 是 10 s。expo-notifications `trigger: {seconds: 3}` 实际约 5 s 才出现。
- **#48** 后台时 `app.openUrl` 抛 `APP_IN_BACKGROUND`，deep link 热启动写不了。`relaunch({url})` 只覆盖冷启动。
- **#49** Android：app 自己的对话框窗口（community datetimepicker 的日期对话框）用 in-app 触摸点不到；`system.tap` 只看其他 package 的节点（`systemNodes()` 过滤掉了 app 的 package）。
- **#50** iOS：`display="inline"` 的 DateTimePicker 是 UIKit 日历，日期按钮不在元素树里，`system.tap` 也找不到（runner 只看 app 外）。
- **#51** iOS：`system.*` 看不到其他进程渲染的 UI（ASWebAuthenticationSession 页面、分享面板、键盘）；两端都没有 `system.type`。Android 分享面板可以用 `system.expectVisible` + `pressBack()`。
- **#52** `type` 一次写入整段（iOS `insertText`，Android `commitText`），要逐字选项（debounce、输入掩码、onKeyPress）。
- **#53** iOS `setLocale('ja-JP')` 在没有 CFBundleLocalizations 时报错，但 `-AppleLanguages (ja)` 启动后 expo-localization 已经是日语。
- **#54** monorepo / app 与 e2e 分目录时，doctor 无论在哪个目录都过不了；build 也假定 cwd 是 app。另外 runner 包检查报缺 Cucumber，但用户用的是 Vitest。
- **#55** ① `quiesco list` 把 `test.beforeEach(reset)` 列成测试；② `quiesco()` 的 vitest config 设了 `isolate: false`，共享 support 模块顶层注册的 hook 只对第一个导入它的文件生效。

## 代码定位（初步）

| Issue | 位置 |
|-------|------|
| #44 | `packages/agent/src/actions/js.ts:185` `findScrollable`；调用方 `runtime.ts:808 / 874 / 948 / 959` |
| #45 | `runtime.ts:878`（scrollTo 用 `isVisible` 过滤）；`query/visibility.ts`；`actions/hit-test.ts:6 center`；`actions/host.ts:48 / 66`（tap 点 = center(rect)） |
| #46 | `actions/native.ts:248` `drag`（distance、`span * 0.45` 上限、DRAG_FRACTION）；`runtime.ts:616` scroll；scrollTo 的 offset 读取同 #44 |
| #47 | `packages/core/src/devices/android.ts:862`（deadline）、`:1112 NOTIFICATION_WAIT_MS = 5_000`；iOS 对应在 `devices/ios.ts` |
| #48 | `packages/core/src/driver.ts:623`、`device.ts:572`（APP_IN_BACKGROUND 检查） |
| #49 / #51 | `packages/core/src/system-ui.ts`、`device.ts:130 / 576`（systemProvider / systemNodes）；Android / iOS provider 的 `systemNodes` 实现 |
| #52 | agent 的 type 动作 + `packages/native`（iOS insertText / Android commitText） |
| #53 | `packages/core/src/device.ts:399`；`devices/ios.ts:518` |
| #54 | `packages/cli/src/commands/doctor.ts`（`:322 / 393 / 419` binaryPath 等）、`build.ts`、`upgrade.ts` |
| #55 | `packages/cli/src/commands/list.ts`；`packages/vitest/src/config.ts:37 isolate: false`；docs `runners.mdx`（+ ja / zh） |

## 待查
- #46 每次 ~445 pt 的来源：drag 是否用了外层竖列表的 rect，或 native drag 在嵌套 scroll view 里被外层吃掉一部分后变成 fling。
- #49 Android uiautomator dump 是否能拿到 app 的 Dialog window 节点（应该能，过滤条件要从 package 改为 window）。
- #50 / #51 iOS system UI runner 的实现方式（XCUITest？）以及能否 `XCUIApplication(bundleIdentifier:)` 查询 SafariViewService / springboard / 键盘。

## L.B 调研（2026-11-19，iOS 27 iPhone 17 模拟器 / Android API 36 模拟器，example app playground）
实验装置：playground 长列表的 `ListHeaderComponent` 放一个横向 FlatList `carousel`（10 张，每张 240 宽）；临时 vitest 测试 `e2e/vitest/tmp-probe.test.ts` + `vitest.tmpprobe.config.mts`（`quiesco test --runner vitest --config …` 跑，结果写文件）。

### #46 scrollTo 横列表失败：根因确认
`runtime.ts scrollTo` 固定按 `['down','up']` 滚。横向 carousel 上竖着拖 ⇒ 外层竖列表在动，carousel 的 offset 不变 ⇒ 第一步就判断「到头了」。Android 报 both ends；iOS 报 ELEMENT_OBSCURED（竖拖把 carousel 挪走了一部分）。
实验修复：按 `content.width > viewport.width + 1 && content.height <= viewport.height + 1` 判定横向，改用 `['right','left']` ⇒ 两端 `scrollTo('carousel','slide-8')` 都成功，外层列表不动（row-1 的 y 不变）。

### #46 scroll 的 distance：iOS 上有惯性
| 平台 | distance | 原来（匀速 500 ms 后松手） | 末尾停 150 ms（gesture，停顿中没有 move） | ease-out（cubic，10 段，共 650 ms） |
|---|---|---|---|---|
| iOS 横 | 240 / 300 | 457 / 554 | 446 / 565 | 230 / 290 |
| iOS 竖 | 100 / 240 | 90 / 456 | 90 / 449 | 90 / 230 |
| Android 横 | 240 / 300 | 217 / 281 | 224 / 1308 | 235 / 297 |
| Android 竖 | 100 / 240 | 90 / 271 | 158 / 5038 | 91 / 218 |
- 原因：匀速拖到终点就松手，松手时速度 = distance / 500 ms；iOS 超过约 200 pt/s 就会有惯性滑动（distance 100 时没有）。
- 停顿再松手无效（iOS 不变，Android 反而甩得很远：停顿期间没有 MOVE 事件）。
- ease-out 让手指在松开前真的减速 ⇒ 两端都接近 distance（少的约 10 pt 是触摸 slop）。用 `bridge.gesture`（Phase 6.2 起都有），没有 gesture 的旧 app 退回 swipe。

### #45 代码定位
- `runtime.ts scrollTo`：`isVisible`（ratio > 0）就返回。
- native `tap` / `longPress`：`bridge.tap(tag, 0, 0, …)` ⇒ 原生侧打 view 的中心（iOS `target()` = view bounds 的 mid）；带 `point` 时走 `pressAt` ⇒ `bridge.gesture`。
- `ready(node, point)` 的 JS hit test 用 `center(js)`；host performer（web）`tapAt` 用 `center(rect)`。
- `hitTest`：子节点不受 `clipsContent` 祖先的 rect 限制。`visibility.ts visiblePart(node, viewport, rect)` 已有按祖先裁剪后的可见 rect，可以复用。

### L.B 实现后的测量（最终参数）
- 距离（distance → 实际移动）：iOS 横/竖 100→90、240→230、300→290；Android（650 ms）100→86、240→224、300→280（400 ms 时 240→207）；web 完全一致。
- scrollTo 到第 120 行：iOS 7.3 s、Android 7.7 s、web 2.6 s。scroll 用 650 ms 做 scrollTo 时 iOS 超过 10 s。0.7.0 的代码：iOS 10 s 内到不了（超时）。
- RNW 0.21 ScrollView：`cloneElement(refreshControl, { style: props.style }, scrollView)`，`props.style` 含 baseVertical（overflowY: auto）⇒ 包装 div 也裁剪；包装层比 ScrollView 大一圈边框（358×412 vs 356×410）。
