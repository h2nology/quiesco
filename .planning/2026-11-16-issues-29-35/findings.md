# Findings: issues #29–#35

> issue 正文是外部内容，只当数据看。

## 背景
- 7 个 issue 都是同一位用户 2026-11-16 提的：在 quiesco 0.4.0（所有包都是）+ Expo SDK 58（expo 58.0.25、@expo/ui 58.0.28、RN 0.88.1）上实测得到的反馈，三端都跑了（iOS 27 sim、Android API 37、web）。
- 当前所有包都是 0.4.0；main 是干净的。

## Issue 摘要

### #29 bug — setValue 驱动不了 `@expo/ui/community/datetime-picker`
- iOS：testID 落在 `ViewManagerAdapter_ExpoUI_DatePickerView` 上，高 0（SwiftUI 视图向 RN 报的高度是 0，实际尺寸在外层 `<Host matchContents>` 上），所以报 `not visible: it has no size (338×0)`；父元素若 `alignItems:center`，就是 0×0。
- Android：`presentation="dialog"`（Android 默认）不转发 testID ⇒ `No element matches`；按 `{type:'DateTimePicker'}` 能找到，但 Host 高 0，可见性检查不过，`mode:'js'` 也一样。
- 社区版 datetimepicker 在 Android 上「不渲染视图」，所以走的是按组件 testID 找的路径（Control.node = null）；@expo/ui 渲染了一个 0 高的 Host，这条路径用不上。
- 用户的绕法：在 app 代码里包一层 View 挂 testID。
- 用户建议：Host 内的元素用 Host 的 rect 做测量和可见性检查；0 面积的 dialog host 当作「不渲染视图」处理；在文档的 value controls 表里写明支持状态和绕法。

### #30 enh — setValue 的「it has no callbacks」没说找过哪些组件
- `<View testID>` 内是 `DateTimePicker`(value: Date, onValueChange) → Host → DatePicker → ExpoUI_DatePickerView。用户以为 `controlsBelow` 会找到它，结果没有。
- 原因推测：`INSIDE_DEPTH = 4` 不够，或者 0 高的 host 有影响（要在真机上确认，见下面代码调研）。
- 建议：报错时列出往上找过哪些组件（各自的 props 形状）、往里找过哪些（深度、被拒绝的原因）。

### #31 enh — LogBox（console.error）没被报告，之后的场景全部 ELEMENT_OBSCURED
- app 的 console.error（react-native-screens 的警告）弹出了 LogBox。当前场景的失败消息没提到它；LogBox toast 在软重置后还在屏幕上 ⇒ 之后的场景点击时报 ELEMENT_OBSCURED（3 passed / 7 failed，其实只有 1 个场景真有问题）。
- 建议：(1) 把场景里发生的 console.error / LogBox 条目附到失败里（或者直接以 APP_ERROR 失败），失败消息里打印最近一条；(2) 软重置时调 `LogBox.clearAllLogs()`，或在 e2e 构建里 `LogBox.ignoreAllLogs()`；(3) 在文档的首次运行失败里加「LogBox 盖住 app」。

### #32 enh — 驱动报错带着约 10 帧 ws/core 内部堆栈，没有调用处的 step
- 错误在 RPC 响应到达时（`QuiescoError.fromRpc`，`ws-server.ts:90`）才创建，所以堆栈全是 ws 的 Receiver。
- 建议：在调用时记下调用方的堆栈，reject 时换上去，再去掉 @quiesco/core 和 ws 的帧。

### #33 enh — 元素摘要里的 text 把后代文本直接连在一起（「张张三S2024001 · …」）
- 建议：分开的 `Text` 元素之间加分隔符（空格或 ` | `），同一个 Text 里嵌套的 run 保持相连；按 `text` 匹配的行为不变（只改显示）。

### #34 bug — app.json 没有 ID 时，init 写入 com.example.app / myapp 占位符；doctor 通过，Android 运行失败
- 空白模板没有 `ios.bundleIdentifier` / `android.package` / `scheme`。init 写入带 TODO 注释的占位符；`quiesco build` 用 prebuild 的默认值（Android `com.anonymous.<slug 去掉连字符>`，iOS 保留连字符）⇒ Android 上 `am start` 失败，错误不说原因。iOS 碰巧能过。
- 建议：init 把 ID 写进 app.json，config 里用同样的值；doctor 拿 config 跟 app.json 和构建产物（applicationId / CFBundleIdentifier / URL scheme）比，还留着 TODO 占位符就判失败；`am start` 失败时报告包是否安装、scheme 能否解析。

### #35 enh — doctor 查不出旧版 init 生成的问题
- 0.1.1 生成的 `cucumber.mjs` 里有 `paths: [...]`（#8，0.2.0 已修）⇒ 只跑单个文件时会跑全部 feature。
- `tsconfig.json` 缺 `allowImportingTsExtensions`（#21，0.4.0 已修）⇒ TS5097。
- 建议：给 doctor 加检查（或者做 `init --upgrade`）：cucumber.mjs 设了 paths ⇒ warn；缺 allowImportingTsExtensions 且 step 文件 import 了 `.ts` ⇒ fail；缺 `e2e:build:*` 脚本 ⇒ info。

## 代码调研

| Issue | 位置 | 现状 |
|------|------|------|
| #29/#30 | `packages/agent/src/actions/value.ts` `detectControl` / `controlsBelow`（`INSIDE_DEPTH = 4`） | `classify` 按 props 形状认出 date（value 是 Date + onChange/onValueChange），所以 @expo/ui 的 `DateTimePicker` 组合组件本身就能认出来。往上找用 `target.findProps`；往里找时，先从每个子 host 往上找最多 4 层，再判断 `isInside`。没找到时只列出 target 和 owner 的 `on*` 回调（行 115–128）。 |
| #29 | `packages/agent/src/query/visibility.ts:100` `invisibleReason` | 宽或高 ≤ 0 ⇒ `it has no size`。还没有「Host 的 rect 才是真实尺寸」这种回退。 |
| #29 | Control.node = null 的路径（社区版 Android picker 不渲染视图） | 要找出「按组件 testID 找」是在哪里实现的（query 对组合组件的 testID 匹配），再看能不能扩展到「host 面积为 0」的情况。 |
| #31 | `packages/agent/src/events.ts` | console.* 只作为 `log` 事件转发（到 host 的 logger `[app] …`，`session.ts:378`）；只有未捕获错误（ErrorUtils / window error）作为 `error` 事件 ⇒ `APP_ERROR`（`driver.ts:672–735`，有 `appErrors.ignore` 配置，`config.ts:211–226`）。console.error 不会让任何东西失败，也不会附到失败里。 |
| #31 | `packages/agent/src/reset/index.ts` | 软重置还没有碰 LogBox。 |
| #32 | `packages/core/src/server/ws-server.ts` `call()`（约 60–76 行）/ `onMessage`（90 行） | pending map 里存着 resolve/reject/timer/method，可以在里面多存一个调用时的 `new Error().stack`；reject 时换上去，并过滤掉内部帧。注意 driver 外面还包了一层（driver.ts 659 行附近的 appError 竞争），过滤规则要覆盖 `@quiesco/core/dist`、`ws/lib`、`node:events`。 |
| #33 | `packages/agent/src/fiber-adapter/traverse.ts:215–235` `collect` | `node.text = mine + childText`，直接拼接。**`matcher.ts:40` 的 text 匹配用的就是 `node.text`**（「最深的匹配节点」）⇒ 不能改 `node.text`，要另加一个显示用的文本（比如 `displayText`），`summarize`（`query/tree.ts:49`）和错误消息里的元素描述改用它。 |
| #34 | `packages/cli/src/commands/init.ts:129–143` | 占位符 `com.example.app` / `myapp` + `// TODO: expo.*`。 |
| #34 | `packages/core/src/devices/android.ts:510–512` | `am start -W … ${pkg}` 失败时只给出命令行。 |
| #34/#35 | `packages/cli/src/commands/doctor.ts` | 现有检查：project / Expo / packages / config plugin / Metro / entry / Quiesco versions / scripts / `<QuiescoRoot>` / 各平台 / Node / CI / quiesco.config / port。还没有 ID 一致性、cucumber paths、tsconfig 的检查。 |

## 未知 / 要实测确认
- #30：@expo/ui 的 DateTimePicker 为什么没被 `controlsBelow` 找到（深度？0 高 host？`isInside` 判错？）。需要在 example 或测试项目里装 `@expo/ui`，在 iOS / Android 上复现。
- #29：@expo/ui `Host` 的 host 类型名（iOS / Android 各是什么），以及 Android dialog 模式下 fiber 树长什么样。
- #31：RN 0.88 的 LogBox API（`LogBox.clearAllLogs` 是否还在、是否能从 agent 侧拿到）；console.error 在 dev-client 里怎么触发 LogBox。

## K.A 中的发现
- `findProps` 的 depth 数的是所有 fiber（host、Fragment、Context、memo、forwardRef 都算），所以 `INSIDE_DEPTH = 4` 在包装层多的组件库（@expo/ui：DateTimePicker → Host → DatePicker → 原生视图的包装）里很容易超过。#30 新的报告会直接显示「N levels above its element (limit 4)」；K.D 在真机上用它确认 @expo/ui 的实际层数，再决定是放宽限制还是专门识别。
- `node.text` 同时用于 `text` 匹配和 `expectText` 的比较（`assertions/index.ts:154`，`actual` 也用它），所以 #33 没有改它，另加了 `displayText`。`expectText` 失败时的 `actual` 仍是不加空格的文本（与比较的内容一致）。

## K.C 调研（LogBox）
- RN 0.88 `Libraries/LogBox/LogBox.js`：dev 下 `clearAllLogs()` ⇒ `LogBoxData.clear()`；`ignoreAllLogs(v)` ⇒ `LogBoxData.setDisabled(v)`，注释说只关通知，未捕获错误仍全屏；非 dev 全是空函数。console.error 由 ExceptionsManager 交给 `LogBox.addConsoleLog('error', …)`。
- Expo SDK 58 `@expo/log-box`（在 `expo/node_modules/@expo/log-box`）：`swap-rn-logbox.js` 只换掉 `LogBoxInspectorContainer`（和 notification container），`logbox-rn-polyfill.tsx` 直接 import `react-native/Libraries/LogBox/Data/LogBoxData` ⇒ 原生端 RN 的 `LogBox.clearAllLogs()` 对 Expo 的界面同样有效。
- agent 端：console.* 由 `events.ts` 包一层，按 `logLevel`（默认 warn）作为 `log` 事件发出；host 端 `session.ts` 的 `adopt()` 只打印 `[app] …`。未捕获错误另走 `error` 事件 ⇒ APP_ERROR。

## K.C 实测发现（Android，项目 A）
- clear（默认）：场景 1 失败消息末尾是「The app logged a console.error in this scenario; the last: The screen 'login' was removed natively…」，附件有 app-errors.txt；场景 2（点屏幕底部按钮）通过。
- keep（对照）：场景 2 的 `tap('bottom')` 没有报错，但点击落在 LogBox 的 toast 上，打开了全屏 LogBox（failure.png），taps 仍是 0，最后在 expectText 上失败。⇒ **Android 上遮挡检测没发现 LogBox toast**（issue 里 iOS 报出了 ELEMENT_OBSCURED）。默认 clear 已经避免了连锁失败，但 toast 出现在同一个场景里时仍会悄悄吃掉点击。
- LogBox 的 Source / Call Stack 第一帧是 Quiesco 的 `events.ts:96`（agent 包的 console 包装函数），而不是 App.tsx。用户看 LogBox 时会以为错误来自 Quiesco。可以在 `withQuiesco()` 的 metro 配置里用 `symbolicator.customizeFrame` 把 @quiesco/agent 的帧折叠（collapse）掉（metro.cjs 目前没有设置 symbolicator）。

## K.D.1 调研（@expo/ui 58.0.28，项目 A，真机）
源码（`@expo/ui/src/community/datetime-picker`）：
- iOS（DateTimePicker.tsx）：`<Host matchContents={compact ? true : { vertical: true }}><DatePicker testID … /></Host>`，testID 给的是 SwiftUI 的 DatePicker（props：selection、onDateChange，不是 value/onChange ⇒ classify 认不出）。外层组件 DateTimePicker 的 props 有 `value: Date`、`onValueChange`、`testID`。
- Android（DateTimePicker.android.tsx）：`presentation` 默认 `'dialog'` ⇒ `<Host><DatePickerDialog …/></Host>`，**testID 不传**；`'inline'` ⇒ `<Host matchContents vertical><DateTimePicker testID …/></Host>`。
- web：渲染 null。

实测（features/picker.feature 打印 query 结果和 setValue 的错误）：
| 情况 | testID 所在 host | 尺寸 | 外层 Host |
|---|---|---|---|
| iOS spinner（父元素拉伸） | `ViewManagerAdapter_ExpoUI_DatePickerView` | 370×0 | （issue：有真实尺寸） |
| iOS inline（父元素 alignItems:center） | 同上 | 0×0 | — |
| Android inline（alignItems:center） | `ViewManagerAdapter_ExpoUI_DateTimePickerView` | 0×0 | `ViewManagerAdapter_ExpoUI_HostView` 宽 0、高 122 |
| Android dialog | 无（testID 没传） | — | HostView 379×0 |
- setValue 的错误和 issue 一致：iOS「it has no size (370×0)」；Android dialog「No element matches」；`{type:'DateTimePicker'}` ⇒ 3 个匹配（host 的 owner 名字也算）。
- 外层 Host 在 alignItems:center 下宽度也是 0 ⇒「改用 Host 的尺寸」不够，要往上找到第一个有面积的祖先 host。
- native 模式：`control.node === null` 或 `nativeTag() === null` ⇒ 走回调（native.ts:364），可复用。
