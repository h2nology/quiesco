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
JS（`expo export --platform all`，在 Web JS 和 iOS/Android 的 Hermes 字节码中 grep 特征字符串）：
- 方案 A（App 代码中 `if (process.env.EXPO_PUBLIC_QUIESCO === '1') require(...)`）：关闭时三端都**完全剔除**（Web 模块数 469 vs 470），开启时存在。
- ⚠️ 同样的守卫写在 **node_modules 包内部时无效**：babel-preset-expo 不会在 node_modules 中内联 `EXPO_PUBLIC_*`（产物里保留着 `process.env.EXPO_PUBLIC_QUIESCO` 的引用），模块在两种模式下都被打包。
- 方案 B（metro.config.js 的 `resolver.resolveRequest` 在非 e2e 时把模块替换成桩）：关闭时三端完全剔除，开启时存在。⇒ **@quiesco/agent 的剔除采用方案 B**（提供 `withQuiesco(metroConfig)`）。
原生（autolinking）：
- autolinking 的 exclude 来源只有 package.json 的 `expo.autolinking.exclude`（静态）和 CLI 的 `--exclude`。iOS：`use_expo_modules!(exclude: [...])`（autolinking_manager.rb:215）；Android：在 settings.gradle 中先设置 `expoAutolinking.exclude = [...]` 再调用 `useExpoModules()`。
- `expo-modules-autolinking resolve -p android --exclude spike-touch` → 结果中没有 spike-touch ✅。
- config plugin `plugins/with-quiesco-native.js`（withPodfile + withSettingsGradle）在非 e2e 的 prebuild 时注入 exclude；e2e 时保持原样（在 scratchpad 副本中 prebuild 两种模式确认）✅。
- ⚠️ 用 scratchpad 副本（node_modules 是符号链接）做最终产物验证**无效**：副本中 `search` 能找到本地模块，`resolve` 却把它过滤掉了（推测是项目根目录被解析成了符号链接的目标），两种模式都没有 SpikeTouch → 改为在主项目上执行 `prebuild --clean` 验证。
- ⚠️ SDK 58 的 release 构建默认开启 R8（`android.enableMinifyInReleaseBuilds=true`），包名会被混淆 → 按类名（dexdump `Lexpo/modules/spiketouch/`）检查，连对照组都是 0，**这种方法无效**。改为检查 dex 中的 Module 名称字符串 `"SpikeTouch"`（来自 `Name("SpikeTouch")`，不会被混淆），对照组 = 1 ✅。⇒ CI 的生产剔除检查要用「不会被混淆的字符串」作为特征。
- **主项目实测** ✅：生产模式下 iOS Podfile.lock 中 SpikeTouch=0、Android R8 release APK 中含 "SpikeTouch" 的 dex=0；e2e 模式下分别为 4 和 1。
- 结论文档：`docs/spikes/06-prod-strip.md`。
- 注意：`prebuild --clean` 清空了 `ios/build/dd`，之后需要在 iOS 上验证时要重新执行 xcodebuild。
### S7 Web 端 Fiber 查询
- 0.1 实测（Chromium headless shell 158 / playwright 1.65.0，Metro dev server `localhost:8081`）：react-native-web 0.21.4 把 `testID` 映射为 DOM 属性 **`data-testid`**（7 个 testID 全部出现）。查询仍以 React props 为准（需求 §6.1），DOM 属性只做交叉验证。
- Web 端没有原生模块，`modules/spike-touch/src/SpikeTouchModule.web.ts` 用纯 JS 桩替代（ping 返回 "web"）。
- ~~Web 页面在 dev 模式下没有安装 React DevTools hook~~ → **S7 实测更正**：Expo Web dev 环境中 hook 已存在（`hookSource=existing`，推测来自 Fast Refresh 运行时）；静态导出（prod）中不存在（`installed`）。两种情况都能拿到 react-dom 渲染器。
- S7 ✅（dev server 与静态导出两种）：
  - 宿主 Fiber 上的 prop 名称是 `data-testid`（RNW 转换后的结果），**没有 `testID`**（`testID` 只留在 RNW 的复合组件上）→ 匹配规则：宿主 props 中的 `testID ?? data-testid`。
  - 「在复合组件上找 testID 再取第一个宿主后代」的算法会让 RNGH RectButton 在 Web 上多命中一个尺寸为 0 的包装 div → 不采用。
  - react-dom 在 children 是单个字符串时不生成 HostText，文本在 `memoizedProps.children` 中 → 文本收集要同时读取（只在没有子 Fiber 时读取，以免 Fabric 上重复计数，已在 Android 上确认）。
  - 坐标：`stateNode.getBoundingClientRect()` 与 Playwright `boundingBox()` 完全一致。
  - S2 的 scheduler 替换在 react-dom 上有效；6 个场景 A&&B + 两次确认误判 0。
  - 结论文档：`docs/spikes/07-web-fiber-query.md`。

## 0.9 SDK 兼容性（静态检查：npm 包源码 grep）
| SDK | expo | RN | React | getBoundingClientRect | getPublicInstanceFromInternalInstanceHandle | DevTools 注入 | 初始化时读取 scheduler | InteractionManager | Paper 渲染器文件 |
|---|---|---|---|---|---|---|---|---|---|
| 55 | 55.0.32 | 0.83.10 | 19.2.0 | ✅ | ✅ | ✅ | ✅ | 有 | 有（但 New Arch 强制） |
| 56 | 56.0.24 | 0.85.3 | 19.2.3 | ✅ | ✅ | ✅ | ✅ | 有 | 有 |
| 57 | 57.0.32 | 0.86.3 | 19.2.3 | ✅ | ✅ | ✅ | ✅ | 有 | 无 |
| 58 | 58.0.23 | 0.88.1 | 19.3.0 | ✅ | ✅ | ✅ | ✅ | **无** | 无 |
- 运行时验证只做了 SDK 58。
- 另外：agent 在 node_modules 中**读不到** `process.env.EXPO_PUBLIC_*`（S6：不会被内联）⇒ JS-only 模式下的构建期兜底参数，需要由 `withQuiesco` 生成虚拟模块等方式注入。

## Phase 1 工具链版本（npm registry，2026-11-07）
- typescript latest = 7.0.2（原生移植版），但 typescript-eslint 8.72.1 的 peer 是 `typescript >=4.8.4 <6.1.0`，Expo SDK 58 捆绑 `~6.0.3` ⇒ **使用 TS 6.0.3**。
- vitest 5.1.0（peer vite ^6.4 || ^7 || ^8，Node ^22.12 || ^24 || >=26）、eslint 10.14.0、typescript-eslint 8.72.1、@eslint/js 10.0.1、dependency-cruiser 18.7.2（Node ^22||^24||>=26）、ws 8.22.1、@cucumber/cucumber 13.3.0、jiti 2.7.0、@types/node 26.6.6（运行时是 Node 24 → 使用 @types/node 24.x 更合适）。

## 技术决策候选
| 问题 | 候选 | 倾向 | 依据 |
|------|------|------|------|
| §6.2-4 交互空闲（InteractionManager 在 RN 0.88 已移除） | A. 改为跟踪挂起的 `requestIdleCallback`；B. 仅在 `InteractionManager` 存在时安装（兼容旧 SDK），否则跳过；C. 删除该 tracker | ✅ 已决定 A+B（HU 2026-11-07） | 官方替代即 requestIdleCallback；Web 端浏览器原生也有，三端一致 |
| spike 目标 SDK | SDK 58（latest） | SDK 58 | 需求要求支持开发时最新稳定 SDK |

## Phase 2.0 验证（2026-11-07，Android Emulator API 37，示例 App + `@quiesco/native` 初版）
验证方式：临时 backdoor `probe` 在 App 内按 testID 找 HostNode → `nativeTag()` → 调用原生函数；Host 脚本（scratchpad/probe.mjs）用 core Session 驱动。临时代码已撤回。
- ① **view tag → 原生坐标**：`UIManagerHelper.getUIManagerForReactTag(ctx, tag).resolveView(tag)`（UI 线程）可取到 View；`getLocationInWindow` 的 dp 值与 JS `getBoundingClientRect()` 完全一致（例：add-todo 16, 850.67, 183.6×47.6）。`getBoundingClientRect` 默认 `includeTransform: true`（ReadOnlyElement.js:190）；native driver 动画未实测（示例 App 无此动画），`getLocationInWindow` 按 Android 语义包含 View 及父级变换。
- ② **RN Modal**：是独立窗口（WindowInspector 窗口数 1 → 2，Modal 在 index 1）；Modal 内元素的 JS 坐标与原生窗口坐标一致（全屏 Modal）；在目标 View 的 `rootView` 上 dispatch 可点中 Modal 内按钮（清空成功）。
- ③ **中文输入**：先 tap 聚焦，再 `onCreateInputConnection(EditorInfo()).commitText("买牛奶", 1)`，受控 TextInput 的 `value` 变为 "买牛奶"（onChangeText 已触发），`mostRecentEventCount` 递增。
- ④ **遮挡判断**：Modal 打开时，下层元素所在窗口 `rootView.hasWindowFocus() == false`，上层 Modal 窗口为 true ⇒ 可用于「被其他窗口遮挡」的报错。`WindowInspector.getGlobalWindowViews()`（API 29+）可列出窗口，作为诊断信息。
- 构建注意：Kotlin/Java 包名不能含关键字 `native`（改为 `dev.quiesco.nativemodule`）；模块需 `implementation 'com.facebook.react:react-android'` 才能用 UIManagerHelper；`expo-modules-autolinking search` 默认不显示仅 android 平台的模块，需 `-p android`。

## Phase 3：全新安装时 dev client 首启弹出菜单（2026-11-08）
- 现象：Wipe Data / 卸载重装后首次运行，expo-dev-menu 自动弹出开发者菜单（底部面板，独立窗口），所有点击报 ELEMENT_OBSCURED。
- 原因（expo-dev-menu `DevMenuFragment.onCreate`）：`shouldShowAtLaunch = canLaunchDevMenuOnStart && (showsAtLaunch || !isOnboardingFinished)`。`__expo_disable_onboarding=1` 只置 `isOnboardingFinished`；`showsAtLaunch` 新装默认 true（meta-data `EXDevMenuShowsAtLaunch`），弹出一次后才写 false —— 所以老设备上不复现。
- 对策：启动 URL 追加 `__expo_disable_auto_launch=1`（本进程内 `canLaunchDevMenuOnStart=false`；iOS 端 `ExpoLauncherURL.swift` 同名参数，Phase 4 复用）。

## Phase 4.0 iOS 原生验证（2026-11-08，iPhone 17 / iOS 27.0 Simulator，示例 App + `@quiesco/native` iOS 初版）
验证方式：`packages/native/ios` 初版（Swift Module + ObjC `QSTouchInjector`），示例 App 临时 backdoor `probe`（按 testID 取 HostNode → `nativeTag()` → 调原生），Host 脚本 scratchpad/`ios-harness.mjs` + `probe-ios-*.mjs`（Session + 临时 simctl provider）。
- ① **view tag → UIView**：Fabric 的 `RCTComponentViewRegistry` dequeue 时设 `view.tag = reactTag`，回收时置 0（RCTComponentViewRegistry.mm:53/67）⇒ 公开 API `[window viewWithTag:]` + 判 `RCTComponentViewProtocol`（`NSProtocolFromString`，不依赖 React 头文件）即可。`convertRect:toView:window` 的坐标与 JS `getBoundingClientRect()` 完全一致（add-todo 16, 814.67, 179×43.33），单位 pt。
- ② **Modal 遮挡**：iOS 的 RN Modal 在同一个 UIWindow 里 present（windowCount 1）⇒ 不能用窗口焦点。改为在目标中心做跨窗口 `hitTest`（从最前面的窗口往下），命中 view 不是目标的子孙 ⇒ `windowHasFocus=false`。Modal 下的 add-todo：hitClass=RCTViewComponentView（Modal 背景）→ driver.tap 报 ELEMENT_OBSCURED；连续 5 轮稳定。
  - **转场期间丢触摸**：Modal `animationType="fade"` 的 present / dismiss 转场约 400ms，期间 UIKit 丢弃触摸；位置不变，JS 也不知道 ⇒ 偶发「点了确定没反应」。对策：`locate` 返回 `settling`（窗口内 VC 有 `transitionCoordinator` / `isBeingPresented|Dismissed`，或目标及祖先 layer 有 `animationKeys`），agent native performer 在 settling 时视为未稳定继续等待。实测 settling 400ms 后点击 4/4 成功；接入 agent 后 5/5。
- ③ **中文输入**：`becomeFirstResponder` + `UIKeyInput insertText:`（RCTUITextField）触发 onChangeText，value="买牛奶"；replace 用全选 + `deleteBackward` 后再 insert，OK。
- ④ **swipe / 滚动**：Moved 阶段用 `_setLocationInWindow:resetPrevious:NO` + HID position 事件；300ms 拖动产生惯性（拖 ~450pt，滚动 1106pt），`waitForIdle` 覆盖惯性结束；`driver.scrollTo('待办 35')` 成功。
- ⑤ **进程内 openUrl**：(a) App 内 `UIApplication.open(ownScheme)` **不弹** SpringBoard 确认框（与 `simctl openurl` 不同），经 SceneDelegate → RCTLinkingManager 正常导航；(b) 直接 post `RCTOpenURLNotification {url}` 也可。采用 (a)（走真实系统路由），(b) 作为备选不实现。
- ⑥ **dev client 菜单 / 浮动按钮**：`--initialUrl` 走 `loadApp`，不经过 URL 参数处理（EXDevLauncherController.m:242）⇒ `__expo_disable_*` 无效（spike 遗留问题的原因）。expo-dev-menu 的开关全部经 `UserDefaults.standard` 读取 ⇒ 启动参数 `-EXDevMenuShowsAtLaunch NO -EXDevMenuIsOnboardingFinished YES -EXDevMenuShowFloatingActionButton NO -EXDevMenuDisableAutoLaunch YES`（NSArgumentDomain 优先）可关闭。对照：全新安装不带参数 → 弹出 onboarding 面板；带参数 → 无菜单、无 FAB。
- **示例 App 布局问题（iOS 26+）**：react-native-screens 4.30 在 iOS 26+ 一律 `edgesForExtendedLayout = UIRectEdgeAll`（RNSScreenStackHeaderConfig.mm:599），内容需自行按安全区域留出顶部间距；示例画面未处理 ⇒ 内容画在导航栏下（greeting y=16、save-todo y=81），Quiesco 正确报 ELEMENT_OBSCURED（真实用户也点不到）。4.5 修示例 App（各画面遵守安全区域）。
- `driver.type` 在 native 档位为追加（与 Android 一致）。

## Phase 4.4（2026-11-08）
- **simctl**：`simctl privacy` 在 Xcode 27 没有 `camera` / `notifications` 服务 ⇒ 这两个权限在 iOS 模拟器上只能警告跳过；授权会终止正在运行的 App（Session 先授权后启动，顺序无碍）。`simctl io screenshot -` 不能输出到 stdout ⇒ 写临时文件再读。
- **断言把 ASSERTION_FAILED 报成 SYNC_TIMEOUT（平台无关的竞态 bug，已修）**：assert 每次重试前用「剩余时间」做同步；最后一轮只剩十几 ms，frame-stable 需要 2 帧（约 33ms）⇒ 同步超时盖掉断言失败。iOS 硬重置后稳定复现（Android 同脚本也能复现时机）。修复：同一次 assert 中已经同步成功过一次后，因截止时间不够导致的 SYNC_TIMEOUT 不再抛出，照常评估并报 ASSERTION_FAILED；从未空闲过仍报 SYNC_TIMEOUT。iOS / Android 复现脚本 A–D 全部变为 ASSERTION_FAILED。

## Phase 4.5 iOS 示例 App 跑通过程中的发现（2026-11-08，进行中）
- **软重置时 QuiescoRoot 被卸载再挂载（已修 agent）**：登录状态下软重置，expo-router 会重新挂载根 layout，QuiescoRoot 的 effect 清理把挂载计数降到 0 → `client.stop()` 以 1000 关闭连接 → reset 报 AGENT_DISCONNECTED（10/10 复现，JS 上下文不变）。修复：最后一次 unmount 后延迟一个 tick 再 stop，同一次提交内重新 mount 则取消。修复后 10/10 成功、连接不变（约 150ms）。
- **iOS 26+ 内容画到导航栏下（示例 App 已修）**：SafeAreaView(top) 只得到状态栏高度（62pt），不含导航栏；改为全平台 `headerTransparent: true` + `useHeaderHeight()`（`expo-router/react-navigation` 公开导出）作为 paddingTop。
- **键盘滑入期间误判遮挡（已修 native）**：KeyboardMotion 监听 keyboardWill/Did{Show,Hide}，期间 settling=true（约 450ms）。
- **Modal 内容未进入窗口时立即报 ELEMENT_NOT_FOUND（已修 agent）**：`found: false` 改为等到截止时间。
- **导航转场检测只看第一层子 VC（已修 native）**：改为递归遍历整个 VC 树（含 isMovingTo/FromParent）。
- **ELEMENT_OBSCURED 带原生诊断（新增）**：data.native = { hitClass, hitChain（命中视图到窗口的父链）, presented（present 链）, settling… }，消息中写出「the touch would reach <class>」。
- **iOS「保存密码？」系统对话框（已修 provider，HU 选方案：provider 关闭自动填充）**：提交含 secureTextEntry 的表单后，系统在 `UITextEffectsWindow` 弹出 Passwords 保存提示，遮住整个 App，且不受软重置影响 ⇒ 连锁失败。App 侧 `textContentType="none"` / `autoComplete="off"` 无效。IosProvider.boot 用 plutil 把模拟器 3 个配置描述文件的 `restrictedBool.allowPasswordAutoFill.value` 设为 NO（与 MDM 限制相同；来源 Detox issue #3761），无需重启即生效；`devices.ios.disablePasswordAutoFill: false` 可关闭。
- **键盘活动后的触摸被丢弃（已修 native）**：iOS 27 上，键盘活动（输入文字、键盘出现 / 改变高度）后 0ms 的触摸不会到达 App，300ms 后可以（实测 0ms ×2 失败、300/600/1000ms 全部成功；与按住时长无关，KIF 的 HID 构造与我们相同，sender ID 无效）。修复：KeyboardMotion 记录 typeText 与全部键盘通知（含 WillChangeFrame / DidChangeFrame），之后 400ms 内 settling=true。
- **原生 UI 转场未纳入同步（已修：新增 `native` tracker）**：软重置后 Stack 重新挂载期间 `loginAs` 触发的导航被 UIKit / react-native-screens 丢掉 ⇒ JS 在待办画面、原生停在空白登录画面。`NativeSettleMonitor` 用 CADisplayLink 每帧在主线程采样（任一窗口 VC 转场、键盘移动 / 刚用过），`Function("idleState")` 同步读取；agent 的 `NativeSettleTracker`（按能力，无此函数即 idle）让所有同步点等待。之后 iOS 全量 3/3 通过。

## Phase 4.6 并行（2026-11-08）
- **cucumber 13 的 `--parallel` 用 worker_threads**（不是子进程）：环境变量 `CUCUMBER_PARALLEL` / `CUCUMBER_TOTAL_WORKERS` / `CUCUMBER_WORKER_ID`（"0" 起）注入每个线程的 `process.env`；每个线程各自加载模块与 config。
- **`simctl clone` 要求源设备关机**（`Unable to clone device in current state: Booted`，code 405）⇒ 不能在 worker 0 用着 base 时克隆。改用 `simctl create "<name> (Quiesco N)" <deviceTypeIdentifier> <runtime>`（`list devices --json` 有 `deviceTypeIdentifier`），不依赖源设备状态。
- **Metro 漏掉文件变更**：本机没装 watchman，长时间运行的 Metro（Node fs 监听）在 `git checkout` / 脚本写文件后，App 已有的 graph 仍是旧代码；而新请求的 graph（curl 同一入口）是新代码。症状：backdoor 列表与源码不符。处理：重启 Metro（`pnpm start:e2e`）。
- **Android 多开同一 AVD**：`Another emulator instance is running. Please close it or run all emulators with -read-only flag.` ⇒ 所有实例都要 `-read-only`（不是只有第 2 台起）。
- **quick-boot 快照过期导致开机后重启**：Quiesco 一直 `-no-snapshot-save`，快照停在旧状态；之后可写运行往 /data 装 APK ⇒ 加载快照后 `boot_completed=1`（4s），约 30s 后 zygote / system_server 重启、adbd 重启（reverse 清空、App 被杀），40s 才稳定。`-no-snapshot-load` 真冷启动 14s 且不再重启（API 37，本机）。
- **dev client 重新启动 Activity 丢 intent extras**：dev client 有历史状态时会以 `flg=0x10018000`（NEW_TASK|CLEAR_TASK）再 START 一次 MainActivity，`currentActivity.intent` 不再带 `quiescoPort/quiescoSession`；`pm clear` 后第一次正常。agent 退回构建期端口 7357 + 匿名会话（并行时可能连到 worker 0 的 server）。
- **Android 17 包更新占位（PackageUpdateActivity）**：App 有可见任务时 `adb install -r` ⇒ `CorePackageUpdate: Adding updating tasks`，SystemUI 在该任务放占位 Activity；更新结束后 `ShellPackageUpdate: launching the base intent and removing placeholder`（`flg=0x8000`，无 extras）。若 Quiesco 的 `am start --es quiescoPort` 落在这段时间内，就会被替换 ⇒ App 连 7357。install 前 `am force-stop` ⇒ `no process with activities in it`，不放占位。修复 ③（native 进程级保存参数）仍需要：dev client 自身还会以 CLEAR_TASK 重新 START 一次。

## Phase 4.7 生产剔除检查（2026-11-08）
- JS 特征选真 agent 独有的字符串字面量（`getIdleState`、`waitForIdle`、`agent error: `）：Web 压缩后与 Hermes 字节码字符串表中都保留；桩（stub.ts）中没有。
- Android 用 Expo Module 名 `QuiescoNative`（R8 不改字符串常量），在 e2e release APK 中出现 3 次；iOS 用 ObjC 类名 `QSTouchInjector`（38 处）和 extern 私有函数 `IOHIDEventCreateDigitizerEvent`（4 处），直接按字节扫描整个 .app，比 nm 更稳（覆盖动态 framework 与类名字符串）。
- Xcode 27 的 `xcodebuild -quiet` 会在 Pods 的 Swift 警告后打印「error: the following command failed with exit code 0 but produced no further output」，并非失败（退出码 0、产物完整）。
