# Findings

> 研究与发现记录。外部来源（网页、文档摘录）都视为不可信数据，只作参考。

## 需求要点（来自 requirements.md）
- 定位：Detox 灰盒能力 + Maestro 易用性 + Cucumber 一等公民 + 原生支持 Expo（三端）。
- 架构：App 内 JS agent 主动连接 Host 的 WS Server（JSON-RPC 2.0）；原生层只做触摸注入；Web 端输入由 Playwright 注入。
- 平台差异只允许存在于两个边界：`fiber-adapter`（App 侧）与 `DeviceProvider`（Host 侧）。
- 只支持 New Architecture（Fabric）；只支持模拟器；Web 首版只验收 Chromium。
- 空闲 = 网络 + 定时器（≤1500ms）+ React + InteractionManager + 画面稳定（结构哈希连续 N=2 帧不变）。
- 软重置目标 < 500ms（Emulator）。

## 环境盘点（Phase 0.0，2026-11-07）

### 本机
| 项 | 值 |
|---|---|
| macOS / CPU | 26.7.2 / arm64 |
| Node | v24.22.1（v24 为 LTS；v26 也已进入 LTS，v22 维护期） |
| pnpm / npm | 12.14.0 / 11.19.1 |
| Xcode | 27.2（27B52） |
| iOS Simulator | iOS 26.5：iPhone 17 / 17 Pro Max / Air；iOS 27.0：iPhone 17 / Air |
| CocoaPods | 1.17.0 |
| Android SDK | `~/Library/Android/sdk`，platforms android-36 / 37.0，adb 37.0.1 |
| AVD | `Medium_Phone_API_37.0` |
| Java | OpenJDK 17.0.20.1 |
| watchman | 未安装（非必需，Metro 可退回 node 文件监听） |

### Expo / RN 版本（npm registry，2026-11-07）
- `expo@latest` = **58.0.23**（SDK 58，2026-09-29 发布）。之前：57（2026-06-30）、56（2026-05-20）、55（2026-02-25）、54（2025-09-10）。
- SDK 58 捆绑：react 19.3.0、react-dom 19.3.0、**react-native 0.88.1**、react-native-web ~0.21.4、expo-router ~58.0.30、expo-dev-client ~58.0.18、RNGH ~3.3.0、reanimated 4.7.1、async-storage 2.2.0。
- 其他：playwright 1.65.0、@cucumber/cucumber 13.3.0。

### 架构（docs.expo.dev/guides/new-architecture）
- SDK 55 起 New Architecture **强制启用、不可关闭**（`newArchEnabled: false` 被忽略）。SDK 54 是最后一个可关闭的版本。
- → 需求「只支持 New Architecture」与 SDK ≥55 天然一致。

### SDK 58 升级指南要点（expo.dev/blog/how-to-upgrade-to-sdk-58）
- RN 0.86 → 0.88（含 0.87 的 breaking changes）。
- **`InteractionManager` 已被移除，官方建议改用 `requestIdleCallback`。** ⚠️ 影响需求 §6.2 第 4 项「交互空闲」tracker —— 需要向 HU 报告并调整（见下方决策候选）。
- iOS 默认生成 `SceneDelegate.swift`（scene 生命周期）。⚠️ 影响 S4：iOS 触摸注入取 key window 要走 `UIWindowScene`。
- Expo Go 新版只支持 SDK 58，且尚未上架商店（「未来几周」）。⚠️ 影响「能否在 Expo Go 运行」的验证，可能只能延后或用 SDK 57 的 Expo Go 对照。
- EAS 的 `sdk-58` iOS 镜像为 Xcode 27.1。

## Android 运行环境注意事项（0.1 实测，API 37 Emulator）
- **Android 17（API 37）新增运行时权限 `android.permission.ACCESS_LOCAL_NETWORK`**：dev client 连接 Metro 时弹出「查找、连接附近设备」授权框，未授权则 App 卡在后台、画面不渲染。`adb shell pm grant <pkg> android.permission.ACCESS_LOCAL_NETWORK` 可以预先授予。⇒ Android DeviceProvider 在 launch 前必须预授予；agent 连接 Host 的 WS 很可能同样受影响（S5 验证）。
- Emulator 刚启动可能处于休眠状态（`mWakefulness=Asleep`），截图全黑。用 `input keyevent KEYCODE_WAKEUP` + `svc power stayon true` 处理。⇒ DeviceProvider.boot 要做。
- dev client 首次启动会自动弹出开发者菜单，并在右上角显示 Tools 浮动按钮。URL 参数 `__expo_disable_onboarding=1&__expo_disable_fab=1` 可以关闭。注意：`adb shell am start -d "<url>"` 时 URL 里的 `&` 会被设备端 shell 当成命令分隔符，必须对整个参数再加一层引号。
- `uiautomator dump` 在 RN 画面上可能长时间不返回 → 只能当人工调试手段，不能作为工具的依赖。
- macOS 没有 `timeout` 命令。
- 模拟器上装有与本项目无关的其他 App，按返回键可能会切到它们 → 测试中不要依赖 HOME/BACK 之后的前台状态。

## iOS 运行环境注意事项（0.1 实测，iPhone 17 / iOS 27.0 Simulator，Xcode 27.2）
- `expo run:ios -d <udid>` 会枚举物理设备（连接 `/var/run/usbmuxd`），本机不存在该 socket，因此直接报错 → 改用 `xcodebuild -workspace ios/spikeapp.xcworkspace -scheme spikeapp -sdk iphonesimulator -destination id=<udid> -derivedDataPath ios/build/dd build` + `simctl install`。Pod 安装 28s。
- **`simctl openurl` 打开自定义 scheme 时，iOS 27 弹出系统确认框「"spike-app" で開きますか?」**（属于 SpringBoard，不属于 App），无法用 simctl 关闭 ⇒ **iOS 上不能依赖深链接传连接参数或做 `openUrl` 动作**（S5 / §6.3 openUrl 需要处理：可能要借助 App 内 Linking 模拟或触摸注入点确认）。
- **expo-dev-launcher 支持进程启动参数 `--initialUrl <url>`**（`EXDevLauncherController.m:881` `initialUrlFromProcessInfo`；模拟器上跳过网络权限检查）：`xcrun simctl launch --terminate-running-process <udid> <bundleId> --initialUrl http://localhost:8081` 可直接加载 bundle，无任何弹窗。⇒ iOS 的连接参数也可以走启动参数（S5 的首选候选）。
- 本机找不到 Simulator.app（`open -a Simulator` 失败），模拟器以 headless 方式运行；`simctl io screenshot` 正常。没有 idb。
- 模拟器系统语言为日语，并装有其他无关 App（WebDriverAgent 等）。

## Spike 发现
### S1 Fiber 查询（原生）
源码阅读（RN 0.88.1 / React 19.3.0，`node_modules/react-native/Libraries/Renderer/implementations/`）：
- 只剩 Fabric 渲染器：`ReactFabric-dev.js` / `-prod.js` / `-profiling.js`（无 Paper）。
- 渲染器在**模块初始化时**调用 `injectInternals`：检查全局 `__REACT_DEVTOOLS_GLOBAL_HOOK__`，要求 `!hook.isDisabled && hook.supportsFiber`，然后 `rendererID = hook.inject(internals)`。internals 含 `rendererPackageName: "react-native-renderer"`、`version: "19.3.0"`、`currentDispatcherRef`、`getCurrentFiber`、`scheduleUpdate` 等。
- 提交时调用 `injectedHook.onCommitFiberRoot(rendererID, root, priority, didError)`，另有 `onPostCommitFiberRoot`、`onScheduleFiberRoot`。**prod 构建同样保留注入逻辑**（`ReactFabric-prod.js:11754`），只是没有 dev 的报错。
- 谁安装 hook：`Libraries/Core/setUpReactDevTools.js` 仅在 `__DEV__` 下 `require('react-devtools-core').initialize(...)`（注释：「Install hook before React is loaded」），由 `setUpDefaultReactNativeEnvironment` 在 InitializeCore 中调用。
- ⇒ 推论（待运行时验证）：
  - debug（dev client）：hook 已由 react-devtools-core 安装，agent 应**包装**已有 hook 的 `onCommitFiberRoot`，不能覆盖。
  - release e2e 构建：没有 hook，agent 必须在渲染器模块加载前**自行安装最小 hook**（`supportsFiber: true`、`inject`、`onCommitFiberRoot` 等）。渲染器似乎在 AppRegistry 首次渲染时才懒加载，入口第一行 import agent 可能就够早 —— 需验证。
  - 根 Fiber 来源：在 `onCommitFiberRoot` 中记录 `root`（FiberRoot），`root.current` 即根 Fiber。

**运行时验证（Android API 37，dev client debug，代码 `spikes/spike-app/spike/`）✅**
- `hookSource=existing`：dev 下 hook 已由 react-devtools-core 安装；包装 `inject` / `onCommitFiberRoot` / `onPostCommitFiberRoot` / `onScheduleFiberRoot` 后，能拿到 `renderer#1 pkg=react-native-renderer version=19.3.0 bundleType=1` 和 root。
- 遍历 `root.current`（child/sibling），以 `tag === 5`（HostComponent）为宿主组件、`tag === 6`（HostText，`memoizedProps` 是字符串）为文本。testID 从 `memoizedProps.testID` 读。4 个 testID 全部命中；宿主类型：Pressable → `RCTView`，RNGH RectButton → `RNGestureHandlerButton`，Text → `RCTText`。画面上共 16 个宿主节点。
- 取坐标：`require('react-native/Libraries/Renderer/shims/ReactFabric').default.getPublicInstanceFromInternalInstanceHandle(fiber)` → `ReactNativeElement`。它有**同步**的 `getBoundingClientRect()`（DOM 风格），`measureInWindow` 的回调也是同步执行的，两者结果相同。注意 shim 是 ESM default export，require 时要取 `.default`。
- 单位是 dp，原点在窗口左上角（edge-to-edge，包含状态栏）。与截图对比：Pressable rect × 2.625 = (395,1070,291×114)px，截图实测 (396,1070)-(685,1183)，误差 ≤1px。✅
- ⇒ 原生端 Fabric 与 Web 都可以用 `getBoundingClientRect()` 取坐标，fiber-adapter 的取坐标接口可以三端统一形态。
- **iOS（iPhone 17 / iOS 27.0，debug）同样通过 ✅**：hookSource=existing，宿主类型与 Android 相同（RCTView / RNGestureHandlerButton / RCTText），16 个宿主节点；单位是 pt（scale=3），`measureInWindow` 同样是同步回调。坐标抽查："Native module: ios" 的 y=361pt × 3 = 1083px，截图中心约在 1107px（高 17pt = 51px），吻合。
- iOS 用 `--initialUrl` 启动时，URL 参数 `__expo_disable_onboarding` 不起作用，dev 菜单的首次引导页仍然会弹出 → 需要另找办法（例如 `simctl spawn <udid> defaults write dev.quiesco.spike ...`，待在 S5 中确认 key）。
### S2 React 空闲检测
源码阅读（ReactFabric-dev.js，React 19.3.0）：
- `FiberRootNode` 上可用的「有待处理工作」字段：`pendingLanes`（未完成的更新 lane 位图，0 表示无）、`callbackNode`（已向 Scheduler 排队的渲染任务，null 表示无）、`cancelPendingCommit`（挂起的提交，例如等待 Suspense 资源）、`timeoutHandle`（Suspense 节流超时）、`suspendedLanes`/`pingedLanes`。
- 被动 effect（useEffect）在提交后异步执行：`flushPassiveEffects` 末尾调用 `injectedHook.onPostCommitFiberRoot(rendererID, root)`（dev 源码里变量名叫 `priority`，实际传的是 root）。⇒ 可以用「onCommitFiberRoot 之后、onPostCommitFiberRoot 之前」判定 passive effects 尚未执行。注意：没有 passive effects 的提交是否也会调用 onPostCommitFiberRoot，需要运行时验证。
- Scheduler：渲染器通过 `Scheduler.unstable_scheduleCallback` 排任务（18068/18201 行）。
- ⚠️ 源码确认（`flushSpawnedWork`，ReactFabric-dev.js:15855）：只有存在被动 effect（或 dev profiler 的 `actualDuration !== 0`）时才进入 `PENDING_PASSIVE_PHASE`，否则不会调用 `onPostCommitFiberRoot` ⇒ **「commit 后、postCommit 之前算忙」的判定不可靠**，dev 与 prod 的行为也不一致。
- 新候选：渲染器通过 `require("scheduler")` 在模块初始化时读取 `unstable_scheduleCallback` / `unstable_cancelCallback`（18068、18201 行）。RN 下 scheduler 由原生的 `nativeRuntimeScheduler` 实现。agent 比渲染器先加载 ⇒ 可以**替换 scheduler 导出对象上的函数，跟踪挂起的任务**（渲染任务和 flushPassiveEffects 都通过它排队）。注意 continuation：回调返回函数表示任务还没结束。
- **候选判定（待运行时验证）**：对 hook 收集到的每个 root，`pendingLanes === 0 && callbackNode === null && cancelPendingCommit === null` 且没有「已提交未 post-commit」的 root。风险：Offscreen/Activity 隐藏子树的 lane 可能长期挂起 → 需要实测。
**运行时验证（Android API 37，debug）**，代码 `spike/scheduler-tracker.ts`、`react-idle.ts`、`S2Lab.tsx`、`s2-run.ts`：
- A = root 字段（pendingLanes / callbackNode / cancelPendingCommit / timeoutHandle≠-1）；B = scheduler 挂起任务（替换 `require('scheduler')` 的导出函数，`schedulerPatched=true`）。
- 每帧轮询 5 个场景，空闲时刻的最终状态全部正确，误判空闲 0 次：
  | 场景 | 触发后同步检查 | A 首次空闲 | B 首次空闲 | 最终状态 |
  |---|---|---|---|---|
  | basic | A 忙(lane 0b100000)，B=0 | 17ms | 17ms | 17ms |
  | effect 链×5 | A 忙，B=0 | 18 | 18 | 18 |
  | startTransition（150×2ms） | A 忙(lane 0b100000000)，B=0 | 373 | 408 | 373 |
  | Suspense（300ms promise） | A 忙 | 403 | 403 | 403 |
  | useDeferredValue | A 忙 | 878 | 893 | 878 |
- ⇒ **A 与 B 互补，必须组合**：组件外 setState 后的瞬间 scheduler 还没排任务（React 用 microtask 排），只有 A 能察觉；transition / deferred 提交后被动 effect 还挂在 scheduler 里，只有 B 能察觉（A 比 B 早 15–35ms 报空闲）。Suspense 等待期间挂起的 lane 留在 pendingLanes，A 持续报忙。
- release（Android）✅：A 与 B 同时报空闲，结果全部正确。
- `<Activity mode="hidden">` ✅：预渲染期间 A 报忙，完成后 pendingLanes 清零，不会永久忙碌。
- ⚠️ iOS Suspense 单次检查误判空闲 1 次：长渲染阻塞 JS 线程后，过期的定时器在同一批中执行，批内回调之间不清空 microtask → promise 的 then 还没运行。**对策：跨宏任务两次确认**，实测误判降为 0。⇒ Phase 1 的 waitForIdle 对所有 tracker 统一使用此规则。
- 「定时器延迟 500ms」的真相：测试代码 `Slow` 组件没有 memo，状态变化时同步重新渲染 330 个子组件（scheduler 运行日志：单个 p3 任务 517–527ms）。是测试代码的问题，不是 RN 的问题。
- RN 0.88 对 `react-native/Libraries/Renderer/shims/ReactFabric` 发出深层 import 弃用警告 → Phase 1 要处理。
- 结论文档：`docs/spikes/02-react-idle.md`。

### S3 Android 触摸注入
- ✅ `MotionEvent.obtain(多指针版, TOOL_TYPE_FINGER, SOURCE_TOUCHSCREEN)` → `appContext.currentActivity.dispatchTouchEvent`，主线程执行（`runOnQueue(Queues.MAIN)`），坐标 dp × density。
- Pressable onPress ✅、按下态 ✅、RNGH RectButton ✅、连续 10 次 ✅（668–1060ms）、点空白处无反应 ✅；单次往返 83–138ms。
- **Pressability 的 `minPressDuration`（130ms，setTimeout）**：抬起且 React 空闲后，pressed 样式还要再保持约 117ms ⇒ timer tracker 是必需的。
- 未验证的风险：RN `Modal`（独立 Dialog 窗口）无法通过 Activity 的 dispatchTouchEvent 送达 → Phase 2 处理。
- 结论文档：`docs/spikes/03-android-touch.md`。
### S4 iOS 触摸注入
KIF（kif-framework/KIF master，Apache-2.0）的做法（gh api 读取原文）：
- UITouch：`setWindow:`（最先调用，会重置其他字段）→ `setTapCount:1` → `_setLocationInWindow:resetPrevious:YES` → `setView:`（命中测试得到的视图）→ `setPhase:` → `setTimestamp:` → `setGestureView:`（如果有）→ `_setIsFirstTouchForView:YES`（没有就退回 `_setIsTapToClick:` + 改 `_touchFlags` ivar）→ `_setHidEvent:`。
- iOS 18 起命中测试要考虑 `_UIHitTestContext contextWithPoint:radius:` + `-[UIView _hitTestWithContext:]`（SwiftUI）；RN 视图用普通 `hitTest:withEvent:` 即可。
- UIEvent：`[UIApplication _touchesEvent]` → `_clearTouches` → `_setHIDEvent:`（IOHIDEvent）→ `_addTouch:forDelayedDelivery:NO` → `[UIApplication sendEvent:]`。tap = 同一个 UITouch 先 Began 发送，再 Ended 发送。
- IOHIDEvent（IOKit 私有 C 函数，extern 声明并链接 IOKit）：hand 事件 `IOHIDEventCreateDigitizerEvent(alloc, ts, transducer=Hand(3), 0, 0, mask=Touch(0x2), 0, 0,0,0, 0,0, range=0, touch=1, 0)`；每个手指 `IOHIDEventCreateDigitizerFingerEventWithQuality(alloc, ts, index=i+1, identity=2, mask=Moved?Position(0x4):Range|Touch(0x3), x, y, 0, 0, 0, 5, 5, 1, 1, 1, range=touching, touch=touching, 0)`，两者都设置 `kIOHIDEventFieldDigitizerIsDisplayIntegrated`（= (11<<16)+25 = 0xB0019）为 1，再 `IOHIDEventAppendEvent(hand, finger)`。ts = mach_absolute_time()。IOHIDFloat 在 64 位下是 double。
- **运行时验证（iPhone 17 / iOS 27.0，debug）✅**：Pressable onPress 0→1（命中 `RCTParagraphComponentView`）、按下态 ✅（抬起后 84ms 恢复）、RNGH 0→1、10 连击 +10（533ms）、点空白处无反应；往返 83ms；截图核对一致。窗口取自前台激活的 UIWindowScene 的 keyWindow；坐标就是 pt，不需要换算。
- 用 `--initialUrl` 启动时 dev client 的齿轮浮动按钮仍会显示（右上角），这次没有影响。
- 结论文档：`docs/spikes/04-ios-touch.md`。§11-3（替代方案）不需要启用。
### S5 连接参数传递
- ✅ iOS：`simctl launch … -quiescoPort P -quiescoSession S` → `UserDefaults.standard.string(forKey:)`（NSArgumentDomain），可与 `--initialUrl` 并用；3.7s 连上，ping 1ms。
- ✅ Android：`am start … --es quiescoPort P --es quiescoSession S`（附在 dev client 的 VIEW Intent 上也可以）→ `currentActivity.intent.getStringExtra`；debug 3.9s / release 2.4s，ping 4–10ms。
- ✅ Web：`page.addInitScript` 注入 `window.__QUIESCO__`（整页刷新后仍有效）；URL query 也可以但不推荐。
- 不采用深链接（iOS 系统确认框、与路由冲突）。构建期 env 只作兜底（不支持并行时每个 worker 独立端口）。
- Android release：merged manifest 中没有 usesCleartextTraffic / networkSecurityConfig（targetSdk 36），但 `ws://localhost` 没有被拦截；官方说法是默认禁止 ⇒ config plugin 仍要显式放行 localhost。
- `ACCESS_LOCAL_NETWORK`：官方文档称只对 targetSdk ≥ 37 强制；targetSdk 36 下 `pm revoke` 无效。loopback 是否豁免没有官方说明 ⇒ DeviceProvider 执行 `pm grant`，失败时忽略。
- 结论文档：`docs/spikes/05-connection-params.md`。
### S6 生产剔除
### S7 Web 端 Fiber 查询
- 0.1 实测（Chromium headless shell 158 / playwright 1.65.0，Metro dev server `localhost:8081`）：react-native-web 0.21.4 把 `testID` 映射为 DOM 属性 **`data-testid`**（7 个 testID 全部出现）。查询仍以 React props 为准（需求 §6.1），DOM 属性只做交叉验证。
- Web 端没有原生模块，`modules/spike-touch/src/SpikeTouchModule.web.ts` 用纯 JS 桩替代（ping 返回 "web"）。
- Web 页面在 dev 模式下没有安装 React DevTools hook（控制台提示 "Download the React DevTools"），⇒ agent 必须在 react-dom 加载前自行安装 hook（与原生 release 构建情况相同）。

## 技术决策候选
| 问题 | 候选 | 倾向 | 依据 |
|------|------|------|------|
| §6.2-4 交互空闲（InteractionManager 在 RN 0.88 已移除） | A. 改为跟踪挂起的 `requestIdleCallback`；B. 仅在 `InteractionManager` 存在时安装（兼容旧 SDK），否则跳过；C. 删除该 tracker | ✅ 已决定 A+B（HU 2026-11-07） | 官方替代即 requestIdleCallback；Web 端浏览器原生也有，三端一致 |
| spike 目标 SDK | SDK 58（latest） | SDK 58 | 需求要求支持开发时最新稳定 SDK |
