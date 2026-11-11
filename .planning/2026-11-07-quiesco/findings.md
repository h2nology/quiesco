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

## Phase 4.8（2026-11-08）
- **HU 撤销并行**：同一 AVD 多开需全部 `-read-only`，与串行可写启动冲突（先串行后并行必失败）；HU 选择只保留串行 + 可写。
- **Metro 再次漏掉变更**：`git checkout` 批量恢复文件后，长时间运行的 Metro（无 watchman）仍提供旧 bundle（含已还原的探针）。改动后用 curl 取 `/examples/todo-app/index.bundle?platform=android&dev=true` grep 特征串确认；不一致就 `--clear` 重启。注意入口路径是相对 monorepo 根目录。
- **frame-stable 偶发超时**：原报错「waited 36ms for idle after the action」说明 10s 几乎全花在动作前同步上（Modal 出现后）；18 次复现未果。诊断已加强：采样帧数 / 耗时 + 首个变化节点。
- **「agent loaded after the React renderer」警告**：dev client 每次 reload（Bundled 1 module）后出现，4.8 前的 Metro 日志已有 256 次；测试不受影响，原因未查（可能是 reload 时 DevTools hook 上已有上一轮的 renderer）。

## Phase 5.0 renderer 早于 agent 加载（2026-11-08）
- **根因**：Metro 在入口文件之前执行 `getModulesRunBeforeMainModule` 中的模块（RN 0.88：`react-native/src/setup-env.js`；Expo：`expo/build/winter`、`@expo/metro-runtime`）。`setup-env → setUpDefaultReactNativeEnvironment → setUpDOM → ReadOnlyNode → NodeInternals → RendererProxy → RendererImplementation → ReactFabric-dev` 在入口前就加载了 renderer（Metro bundle 末尾 `__r(...)` 顺序 + 依赖图 BFS 确认）。入口第一行 import agent 也来不及。
- **影响**：① dev（有 react-devtools 预装的 hook）：renderer 已注册，agent 包装 hook 仍能看到之后的 root ⇒ 测试通过，但每次加载都报「loaded after the React renderer」（误报）；② scheduler：renderer 在模块初始化时把 `unstable_scheduleCallback` 存进局部变量，之后再打补丁无效 ⇒ 检测器 B 实际失效（A 和其他 tracker 兜住了）；③ **release e2e 构建**（无 DevTools hook）：renderer 初始化时找不到 hook，之后 agent 自装的 hook 永远收不到 inject ⇒ 查询全部 ELEMENT_NOT_FOUND、frame-stable「no frame」（release APK 实测 0/6，logcat「No React renderer registered」）。
- **修复**：agent 新增 `src/early.ts`（只装 hook + scheduler 补丁，不 import react / react-native）；`withQuiesco()` 在 e2e 模式把它放到 `serializer.getModulesRunBeforeMainModule` 最前面（路径用 realpath）；`install.ts` 也 import 它（保证在图里）。「装得太晚」改为：已注册 renderer 只有在已渲染过 root 时才报（经 `getFiberRoots` 接管这些 root）。
- **注意**：metro.config 只在 Metro 启动时读取，改了 metro.cjs 要重启 Metro；本机无 watchman，Metro 多次漏掉文件变更（git checkout、追加写入），验证前用 curl 取 bundle grep 特征串。
- **Expo 导出（release）不读 withQuiesco 返回的 serializer**：`withExpoSerializers` 在 `getDefaultConfig()` 时把原始 config 闭包进自定义 serializer，导出时从原始 `config.serializer` 取 `getModulesRunBeforeMainModule`；dev server 才读返回值 ⇒ 第一次修复只对 dev 生效。`withQuiesco` 改为同时写回原始 serializer 对象。用 `expo export:embed --dev false --minify false` 导出后看末尾 `__r(...)` 顺序可直接验证。
- **Gradle 不感知 monorepo 包的变化**：`createBundleReleaseJsAndAssets` 的输入不含 `packages/agent`，改了 agent 后仍 UP-TO-DATE（APK 里是旧 JS）。删掉 `android/app/build/generated/assets/react/release` 再构建。检查 Hermes 字节码要 `grep -a`。

## Phase 5.2 权限 / 键盘（2026-11-08）
- **RN 0.88 `Keyboard.isVisible()` / `metrics()`**：Keyboard 单例在模块加载时监听 keyboardDidShow / DidHide，metrics 为屏幕坐标 `{screenX, screenY, width, height}`；react-native-web 没有这两个方法。
- **Android 模拟器默认不弹软键盘**（AVD 有硬键盘 hw.keyboard=yes）；要验证键盘相关行为需 `adb shell settings put secure show_ime_with_hard_keyboard 1`。logcat `ImeTracker ... onRequestHide at ORIGIN_CLIENT reason HIDE_SOFT_INPUT` = App 自己收起键盘。
- **Android 注入的触摸会穿过键盘**：dispatchTouchEvent 进 Activity 窗口，被 IME 盖住的元素也能点到（真实用户做不到）⇒ 自动收起键盘后行为才与用户一致。
- **`simctl privacy`（Xcode 27）服务**：calendar、contacts(-limited)、location(-always)、photos(-add)、media-library、microphone、motion、reminders、siri；**没有 camera、notifications**。location 授权记录在 `data/Library/Caches/locationd/clients.plist` 的 `Authorization`（revoke=1、grant=2）。
- **权限映射**：camera → Android CAMERA / iOS ✗ / Web camera；microphone → RECORD_AUDIO / microphone / microphone；location → ACCESS_FINE+COARSE_LOCATION / location / geolocation；notifications → POST_NOTIFICATIONS / ✗ / notifications；contacts → READ_CONTACTS / contacts / ✗；photos → READ_MEDIA_IMAGES / photos / ✗；calendar → READ+WRITE_CALENDAR / calendar / ✗。Android 只能授予 manifest 中声明过的权限（否则警告）。

## Phase 5.5 全新项目验收（2026-11-08）
- **create-expo-app（SDK 58 默认模板）**：`main: expo-router/entry`，路由在 `src/app/`，`app.json` 的 `web.output` 默认是 **`server`**（SSR）：`expo export --platform web` 生成 `dist/client`（无 index.html）+ `dist/server`，需 `npx expo serve <项目目录> --port N` 托管。
- **npm overrides**：同一个包既是直接依赖又在 overrides 中 ⇒ `EOVERRIDE`；npm 会把顶层 file: tarball（0.0.0）复用给其他包的 "0.0.0" 依赖，所以只需 pin 非直接依赖。pnpm / yarn 各自解析，需要全部 pin。
- **模板首页的装饰动画**：`src/components/animated-icon(.web).tsx` 用 Reanimated `Keyframe` 做 4 分钟（`60*1000*4`）的旋转光晕，元素外接矩形每帧变化 ⇒ frame-stable 永远不稳定。
- **`expo serve <dir>` 的 dir 是导出目录**（帮助文字写「项目目录」）：传项目目录会以静态方式托管该目录（日志「Starting static server in …」，全部 404）；传 `dist` 才是「Starting server in …/dist」并做 SSR。

## Phase 6 调研 A：Quiesco 动作链路与扩展点（2026-11-08，读代码所得）

**链路**：`Driver.<op>()` → `Driver.action()`（core/driver.ts L181-196）→ JSON-RPC `action` → agent `Runtime.action()`（runtime.ts L291-346）→ `resolveActionTarget`（同步 + 唯一可见 + 键盘遮挡则收起）→ performer（`js` / `native` / `host`）→ 原生内执行后 agent 同步；或返回 `HostInput` → `provider.injectInput()` → Driver `waitForIdle`。

- protocol：`ActionSpec`（actions.ts L8-19）11 种；`HostInput`（L27-35）有 tap / type / drag / wheel / key / navigate / back —— **drag、key 已定义且 web 已实现，但 agent 从未产生**。错误码 1001–1014。
- Driver 无任何设备级方法（relaunch / screenshot / background / orientation 均无）；actions 断线不重试。
- agent performer 接口（actions/performer.ts L17-29）：tap / longPress / doubleTap / type / clear / scroll / swipe。scrollTo 在 agent 内循环，host performer 时退回 js 滚动。
- js 档位：`press` 调 onPress 等（尊重 disabled）；`changeText` 调 onFocus / onChange / onChangeText；RNGH 手势不支持。
- native 档位：`ready()` 稳定位置 + 窗口焦点 + JS hitTest → ELEMENT_OBSCURED；tap 永远点视图中心（x/y 传 0）；scroll / swipe 都走 `bridge.swipe(tag, from, to, ms)`（经过中心、各侧约 35%）。
- 原生模块 JS 面：getLaunchParams / locate / tap(tag,x,y,holdMs,count；tag<0 点窗口坐标) / swipe(任意 from-to) / typeText(tag,text,replace) / openUrl?（仅 iOS）/ idleState?（仅 iOS）。
- iOS 注入：私有 API UITouch + IOHID 手事件，**单指**（静态 qsCurrentTouch）；多指需重构为 N 个 finger child。键：`insertText("\n")` = 回车 / onSubmitEditing，`deleteBackward()` = 退格，最省事。
- Android 注入：MotionEvent pointerCount=1；多指用公开 API（多 PointerProperties + ACTION_POINTER_DOWN/UP）可行。键：`InputConnection.sendKeyEvent` / `performEditorAction`，或 host `adb input keyevent`。Android 无 openUrl / idleState。
- DeviceProvider（provider.ts L11-27）：boot / install / launch({port, sessionId}) / terminate / grantPermissions / screenshot / injectInput? / shutdown / diagnose?。**无** background、orientation、location、push、biometrics、带参重启、URL 黑名单。
  - iOS simctl 可用未用：`push`、`location set`、`ui appearance`、`status_bar`、`keychain`；生物识别需 notifyutil 路线。iOS injectInput 对 back / navigate / 其余全部 ACTION_NOT_SUPPORTED。
  - Android adb 可用：`input keyevent HOME`、`am start`、`settings put system user_rotation`、`emu geo fix`、`cmd notification`、`emu finger touch`。
  - Web Playwright：`setGeolocation`、`setViewportSize`、`context.route`（URL 黑名单 / mock）、`page.screenshot`；pinch 需 CDP `Input.dispatchTouchEvent` 双指。
- Session：`LaunchParams` 只有 port + sessionId，`launch()` 私有；带参重启需扩展 LaunchParams（args / url / newInstance）+ 各 provider 传参 + 公开 `Session.relaunch()`；Driver 已能透明重连。
- 测试位置：agent `test/{actions-js,native,host,runtime}.test.ts`；core `test/{driver,ios,android,session}.test.ts`（注入 Exec）；native 无原生单测；示例 `examples/todo-app/features/*`。

## Phase 6 调研 B：Detox 20.51.4 API 与痛点（2026-11-08，官方文档 + 源码 667efcb；外部资料，仅作数据）

**元素动作**：tap(point?) / multiTap(n) / longPress(point?, duration?) / longPressAndDrag(duration, nx, ny, target, tx, ty, speed, hold) / swipe(dir, speed?, offset?, startX?, startY?) / scroll(offsetPt, dir, startX?, startY?) / scrollTo(edge, startX?, startY?) / scrollToIndex(i)【仅 Android】/ typeText / replaceText（文档称可能不触发全部回调）/ clearText / tapReturnKey / tapBackspaceKey / setColumnToValue【仅 iOS】/ setDatePickerDate / adjustSliderToPosition / pinch(scale, speed, angle)【仅 iOS】/ performAccessibilityAction / getAttributes / takeScreenshot(name)。`whileElement` 只在 waitFor 上。没有 doubleTap、通用 drag。

**Matcher**：by.id / text / label（均可 RegExp）、by.type（类名或语义类型 image/input-field/text/button/scrollview/list/switch/slider/picker/activity-indicator/progress，未写入文档）、by.traits【iOS】、withAncestor / withDescendant / and、atIndex（iOS / Android 顺序不同）。

**断言**：toBeVisible(pct=75) / toExist / toBeFocused / toHaveText / toHaveLabel / toHaveId / toHaveValue / toHaveSliderPosition / toHaveToggleValue / .not。**expect 不自动等待**，只有 waitFor().withTimeout()；无全局默认（#4885 不了了之）。无 enabled / attribute 断言。

**device**：launchApp({newInstance, permissions【iOS】, url, userNotification, userActivity【iOS】, resetAppState, delete, launchArgs, languageAndLocale【iOS】}) / terminateApp / sendToHome / reloadReactNative（文档自认不稳）/ install / uninstall / resetAppState / openURL / sendUserNotification / sendUserActivity【iOS】/ setOrientation / setLocation / setURLBlacklist / enable/disableSynchronization（全局开关）/ resetContentAndSettings【iOS】/ tap / longPress（屏幕坐标）/ takeScreenshot / captureViewHierarchy【iOS】/ generateViewHierarchyXml / shake【iOS】/ 生物识别【iOS】/ clearKeychain【iOS】/ setStatusBar【iOS】/ reverseTcpPort【Android】/ pressBack【Android】/ getUiDevice【Android】/ appLaunchArgs / selectApp（多 App）。

**其他**：WebView（web.element(by.web.id/css/xpath…)，tap / typeText / runScript 等；Android 多处有问题）；系统弹窗 system.element(by.system.label)【实验性，仅 iOS】；Pilot（LLM 驱动步骤）；artifacts：截图 / 视频 / 日志 / instruments / uiHierarchy；retries；只内置 Jest；并行 worker；无真机 iOS（#95）；无一方 Web；Expo「社区自行负责」。

**同步**：网络、主线程、布局、定时器（setInterval 忽略、setTimeout 只等 ≤1.5s）、动画、JS 线程。全有或全无，除 URL 外不能按资源 / 动画排除（#1513 自 2019 未解决）。

**痛点（可作为「比 Detox 好」的抓手）**
- Expo SDK 56+ Android 网络同步失明：只看 OkHttp，`expo/fetch` 成为全局 fetch 后看不到（#4973，未修关闭）。
- RN 0.85.3 bridgeless 崩溃（反射私有字段，#4963）；每个 RN 版本都要适配。
- 同步太严 → 无限动画 / 轮询 / websocket 卡死；唯一出路是全局关同步。
- iOS 键盘挡第一次点击（#3399）、回车键因可见性检查点不到（#4546）。
- WebView 输入不稳（#4886 等）；大量 iOS 独占能力；构建集成复杂（测试 APK、ProGuard、framework cache）；artifact 文档「To be done」；issue 多以不活跃关闭。

## 6.1 源码确认（RN 0.88.1，node_modules/react-native，2026-11-09）
- 宿主组件名（codegen / requireNativeComponent）：RCTView、RCTText、RCTVirtualText、RCTSelectableText、RCTImageView、RCTScrollView、RCTScrollContentView、AndroidHorizontalScrollView、AndroidHorizontalScrollContentView、RCTSinglelineTextInputView、RCTMultilineTextInputView、AndroidTextInput、Switch（iOS）、AndroidSwitch、ActivityIndicatorView、AndroidProgressBar、ModalHostView、SafeAreaView、AndroidSwipeRefreshLayout、PullToRefreshView、AndroidDrawerLayout。**实际 fiber.type 字符串需在设备上用 tree 核对**（codegen 名与 paper 名可能不同）。
- TextInput 当前文字：宿主组件 prop `text`（= value ?? lastNativeText，TextInput.js L614/L688）。
- 焦点：`TextInput.State.currentlyFocusedInput()` 返回 HostInstance（public instance），与 `getPublicInstanceFromInternalInstanceHandle(fiber)` 可直接比较。
- 有 displayName 的核心组件：ActivityIndicator、Button、Image、Modal、Pressable、ScrollView、Text、TextInput、TouchableHighlight、TouchableNativeFeedback、TouchableOpacity、View。**FlatList / SectionList / Switch 没有**——release 构建会被压缩，语义类型不能依赖复合组件名；改用宿主类型字符串（不压缩）+ role + ownerProps（如 `renderItem` ⇒ list）。

## 6.1 实测发现（2026-11-09）
- react-native-web Switch 结构：外层 View（`other` props，含 testID，**不含** aria-label / disabled / value）> track View、thumb View、`<input type="checkbox" role="switch" checked disabled aria-label>`（createElement 直接创建，opacity 0 绝对定位）。
- RNW 的 Text / Image / ScrollView / ActivityIndicator / Switch / TextInput / Pressable / View 都显式设置了 displayName（压缩后仍可用）。
- React 19 work tag（RN 0.88 渲染器源码确认）：0 Function、1 Class、11 ForwardRef、14 Memo、15 SimpleMemo、7 Fragment。
- Expo monorepo 下 Metro 的 server root 是仓库根：bundle 路径为 `/examples/todo-app/index.bundle`；expo-router 的路由模块不在主 bundle（require.context 懒加载）。
- 无 watchman 的 Metro 不会发现**新建**文件（文件 map 过期），表现为「Unable to resolve ./semantic」。

## 6.2 源码确认（2026-11-09）
- `VirtualizedList.scrollToIndex`（@react-native/virtualized-lists，RN 0.88）：index 越界 → invariant；**无 getItemLayout 且 index > 已测量的最大行** → 有 onScrollToIndexFailed 则回调后 return，否则 invariant 抛错（「should be used in conjunction with getItemLayout or onScrollToIndexFailed」）。⇒ Quiesco 不能直接调用：先判断是否安全（私有 `_listMetrics.getHighestMeasuredCellIndex()`，取不到则 try），不安全时向目标方向滚动、等空闲、重试。
- 原生现状：iOS / Android `tap(tag≥0)` 永远点视图中心；`swipe` 无按住阶段；均为单指（6.4 再扩多指）。

## 6.2 实测发现（2026-11-09）
- Fabric（iOS）挂载层级 ≠ React 层级：canvas（有边框）的子节点 quadrant 的原生 superview 是屏幕容器，而非 canvas。原生「是否后代」不能用于可达性判断；`UIView.tag` = React tag，可与 JS `__nativeTag` 对照。
- iOS 26：UINavigationController 在内容区任意位置右滑即返回（不仅是左边缘）；JS PanResponder 挡不住，需 `gestureEnabled: false`。
- react-native-web ResponderSystem：出现文本选择（selectionchange）时终止当前 responder ⇒ 鼠标拖过文字时 PanResponder 收到 terminate 而非 release。
- react-native-web 自带的 VirtualizedList（dist/vendor）用 `_highestMeasuredFrameIndex`，RN 0.88 用 `_listMetrics.getHighestMeasuredCellIndex()`。
- `expo start` 在 `CI=1` 时不监听文件变化。

## 6.3 spike（2026-11-09，iOS 27 Simulator iPhone 17，示例 App 值控件页）
- **库源码确认**：datetimepicker 9.2.1 Android 版组件渲染 null，在 effect 中命令式 `DateTimePickerAndroid.open()`，卸载 cleanup 调 `dismiss()`（⇒ 从 JS 调 onChange 后 App 卸载组件即关闭对话框）；Web 无实现（渲染 null + warn）；iOS 版把 onChange 包成 `{type:'set', nativeEvent:{timestamp, utcOffset}}` 再调 onValueChange(event, date) 或 onChange(event, date)。Picker web 渲染 `<select>`，option value = String(item.value)。slider web 为 JS 实现（可用宽度 = 容器宽 − THUMB_SIZE）。
- **iOS 滑块几何**：`UISlider.thumbRect(forBounds:trackRect:value:)` 取最小 / 最大值时拇指中心（示例：minX 34.5、maxX 326.5，value 20 → thumbX 92.5），精确，不用估算。
- **iOS 滚轮列位置**：`UIPickerColumnView` 每列都铺满整个 picker，靠 3D 变换排布，frame / convert 得到的 x 互相重叠，不可用；改为沿选中带每 2pt 做一次 hitTest，归属到哪个 column view ⇒ 各列可触摸的 x 范围（日期：月 17–187、日 189–237、年 239–345）。
- **iOS 滚轮真实拖动**：慢速拖动 + 终点停留 ≥200ms 再抬起，没有惯性；Picker 上拖 3×行高（45pt）⇒ 选中第 3 行，RN onValueChange 触发；DatePicker 日列上拖 3 行 15→18，月列下拖 1 行 January→December（各列独立循环，年不变）。**拖完立刻读会读到中间状态**（selectedRow 还是 2；`UIDatePicker.date` 在停下后才更新）⇒ 必须轮询到稳定。日期列：rows 10000（月 / 日循环，年 row = 年份 − 1）；标题经 delegate / 行视图 UILabel 可读。
- **iOS 无障碍动作**：RN Fabric 把**每个**声明的 action 都放进 `accessibilityCustomActions`（name = label ?? name），`accessibilityActivate` 走 onAccessibilityTap（不是 onAccessibilityAction）；`accessibilityIncrement/Decrement` 发 increment / decrement。实测 increment / 自定义「重置」/ activate 都触发 onAccessibilityAction，未声明的名字原生报错并列出已有动作。
- **Android 无障碍动作**（源码）：ReactAccessibilityDelegate 标准名 → ACTION_CLICK / LONG_CLICK / SCROLL_FORWARD / SCROLL_BACKWARD / EXPAND / COLLAPSE，其余按名字从 0x3f000000 起全局分配 id，按声明顺序 addAction ⇒ 按「非标准动作中的序号」从 `createAccessibilityNodeInfo().actionList` 取 id。

## 6.4 spike（2026-11-09，iOS 27 Simulator / Android API 37 Emulator / Chromium，RNGH 3.3.0）
- **注入方式**：iOS 一个 UIEvent 里放 N 个 UITouch（各自 Began / Moved / Stationary / Ended），HID hand 事件下挂 N 个 finger 子事件（index i+1、identity i+2）；Android 多 pointer MotionEvent（ACTION_DOWN → ACTION_POINTER_DOWN(index) → 带全部 pointer 的 ACTION_MOVE → ACTION_POINTER_UP → ACTION_UP）；Web 用 CDP `Input.dispatchTouchEvent`（每帧按「新增 / 移动 / 抬起」分别发 touchStart / touchMove / touchEnd，touchPoints 为该事件之后仍按下的手指；CDP 对每个变化的触点各产生一个 DOM 事件）。三端 RNGH Pinch / Rotation / 双指 Pan 均能识别；iOS UIScrollView 原生双指缩放也能识别。
- **识别器从激活点开始计量**（无补偿时：iOS 2→1.76、0.5→0.53、90°→83°；Android 2→1.46、0.5→0.60、90°→81°；Web 2→1.19、0.5→0.69、90° 在 ±5° 内）。源码：Android ScaleGestureDetector 跨度变化 2×touchSlop 才开始、RNGH 再过 1×touchSlop 激活并把 scale 重置为 1；RNGH Web 同理（DEFAULT_TOUCH_SLOP 15 → 约 45 px）；旋转 Android / Web 阈值 π/36（Android 激活时重置、Web 不重置）。
- **补偿（lead-in）**：手指先移动该平台阈值再开始计入的移动。实测阈值：iOS 9 pt / 7°，Android 26 dp / 9°，Web 46 px / 0°。补偿后两次运行读数一致：iOS 2.00 / 0.50 / 1.50 / 90° / ScrollView 2.00；Android 2.02 / 0.50 / 1.51 / 90°；Web 1.98 / 0.50 / 1.51 / 90°。

## 6.5 spike（2026-11-09；脚本在 spikes/lifecycle/）
**③ Web 后台（web-visibility.mjs，Chromium 158 / Playwright 1.65）**：受 Playwright 控制的页面无法真正进入 hidden。试过：同 context 新开 page + bringToFront、CDP `Page.setWebLifecycleState`（frozen 需先 hidden，不触发 freeze）、`Emulation.setFocusEmulationEnabled`（`setActiveAndFocused` 不存在）、`Browser.setWindowBounds` 最小化；无头 / 有头 × 保留 / 去掉 `--disable-renderer-backgrounding` 等默认参数，`visibilityState` 始终 visible、无 visibilitychange。⇒ Web 的 sendToBackground / bringToForeground 报 ACTION_NOT_SUPPORTED（按计划不伪造事件）。

**② Android 以深链接冷启动（android-lifecycle.mts，dev client，API 37）**：expo-dev-launcher 58.0.18 支持新格式 `quiescotodo://<路由>?__expo_url=<metro>&__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1`（expo-dev-menu `ExpoLauncherUrl`：去掉 `__expo_*` 后的 strippedUrl 作为 App intent 的 data，extras 保留）。实测 5.8 s 连上，首屏直接是 playground；RN `Linking.getInitialURL()` 与 expo-linking `getLinkingURL()` 都是 `quiescotodo://playground`。非 dev client：`am start -a VIEW -d <url>` + extras。
- 现有无 url 启动用的是 legacy `expo-development-client/?url=` 格式，此时 App 看到的初始 URL 是 dev client URL 本身（expo-router 当作根路由）。

**① Android 后台**：`input keyevent KEYCODE_HOME` → 启动器在前台；`am start -a MAIN -c LAUNCHER -n <pkg>/.MainActivity` 回前台：同一 pid、路由保留、AppState `background` → `active`。后台期间连接与 JS 都活着（getIdleState 立即返回），但 **frame-stable 不出帧、RN 定时器被暂停（0 ms setTimeout 挂着）** ⇒ 任何等空闲的调用会一直等到回前台。⇒ AppState≠active 时 frame-stable 与 timer 都要视为空闲，元素动作报 APP_IN_BACKGROUND。

**④ Android `pm clear`**：之后用常规 dev client URL 启动能正常连上（23.8 s，缓存被清所以慢），回到首页。运行时权限被撤销 → relaunch 后需重授。

**① iOS 后台（ios-background.mts，iOS 26.5 iPhone 17）**：`simctl launch <udid> com.apple.Preferences` 把 App 挤到后台：AppState `inactive` → `background`；约 20 s 内被挂起（调用无响应），pid 不变；`simctl launch <bundle>`（不带 --terminate-running-process）回前台，同一 pid，连接恢复。无需原生模块。

**② iOS 初始 URL（源码）**：expo-router 58.0.30 在 iOS 读 expo-linking `getLinkingURL()` = `ExpoLinkingRegistry.shared.initialURL`（internal），只由 `LinkingAppDelegateSubscriber.application(_:open:)` 设置（public 类）。dev client 把 `--initialUrl` 当作 bundle URL；`simctl openurl` 有确认框且不能带启动参数。⇒ 方案：原生模块 OnCreate 读 `-quiescoUrl`，用 ObjC runtime 找 `ExpoLinking.LinkingAppDelegateSubscriber` 实例并调用 open（无编译期依赖）。RN `Linking.getInitialURL()`（读 launchOptions）拿不到——写入 platforms.md。
- **实测（ios-launch-url.mts）**：第一版在 OnCreate 线程直接 `cls.init()` → 崩溃（EXC_BREAKPOINT：app-delegate subscriber 是 @MainActor，`BaseExpoAppDelegateSubscriber.init` 做执行器检查）。改为 `DispatchQueue.main.async` 后 4/4 次冷启动都直接进入 playground（2.3 s 连上），expo-linking = `quiescotodo://playground`，RN Linking = null。注意：原理上是与 expo-router 首次读取的竞态（模块注册早于 JS 执行，目前余量足够）；实现时保留，在 platforms.md 写明。
- **① iOS 原生 suspend**：`UIApplication.shared.perform("suspend")`（私有，e2e 构建）→ 回到主屏幕（截图确认），AppState `inactive` → `background`；`simctl launch <bundle>`（不 terminate）回前台，同一 pid，连接恢复。
- **决定（实现）**：iOS sendToBackground 有原生模块时用 suspend（主屏幕，同 Detox sendToHome），JS-only 构建退回「打开设置 App」；bringToForeground 统一 `simctl launch`。后台期间 iOS 约 20 s 后挂起 JS ⇒ Driver 在后台状态下直接报 APP_IN_BACKGROUND，不发请求。
- spike 脚本问题（非产品问题）：relaunch 后立刻发请求会落在即将关闭的旧连接上 → AGENT_DISCONNECTED；正式 relaunch 必须像 `Session.launch()` 一样传 previous 等新连接。
- `CI=1` 的 Metro 不监听文件变化：spike 期间新增的 backdoor 需重启 Metro 才生效（已知，再次遇到）。

## 6.6 spike（2026-11-09；脚本在 spikes/device-state/，示例 App 临时探针 backdoor 已删）
环境：iOS 26.5 iPhone 17 模拟器（系统语言日语）、Android API 37 模拟器、Chromium 158。
**① 旋转**：iOS 原生 `UIWindowScene.requestGeometryUpdate(.iOS(interfaceOrientations:))`（+ `setNeedsUpdateOfSupportedInterfaceOrientations`）立即生效，`Dimensions` 402×874 → 874×402，JS context 不变（simctl 无旋转命令）。Android `settings put system accelerometer_rotation 0` + `user_rotation 1/0` 立即生效（411×914 ↔ 914×411），同一 JS context。Web `setViewportSize` 宽高互换 → `resize` 事件、`screen.orientation` = landscape-primary。前提：App 不锁方向（示例 App 改 `orientation: default`）。
**② 外观**：示例 App 原 `userInterfaceStyle: light` 时两端系统切换都不影响 App（App 自己锁定）；改为 `automatic` 后 simctl `ui appearance dark` / `cmd uimode night yes` 立即生效，`Appearance` 发 change 事件，同一 JS context。Web `page.emulateMedia({ colorScheme })` → `matchMedia` change 事件（异步）。⇒ App 锁外观时 setAppearance 无效：实现时设置后检查 App 报告的 colorScheme，不一致就报错并说明 userInterfaceStyle。
**② 字号**：iOS `ui content_size` 实时生效（extra-extra-large → fontScale 1.235，accessibility-extra-large → 2.643，恢复 large → 1），同一 context。Android `settings put system font_scale 1.3` 生效，但 Activity 重建（configChanges 无 fontScale）：同 pid 同 JS context，React 根重新挂载（expo-router 报 multiple NavigationContainers 警告）、AppState background → active。Web 无系统字号。
**② 语言**：Android `cmd locale set-app-locales <pkg> --locales ja-JP` 生效（Intl → ja-JP），同 pid 同 JS context，Activity 重建（同上警告）；`--locales ""` 恢复。iOS 需 App 声明支持该语言（Info.plist `CFBundleLocalizations`，示例加 en / ja），否则 `-AppleLanguages` 无效；声明后带 `-AppleLanguages (ja) -AppleLocale ja_JP` 重启 → ja-JP，`(en) en_US` → en-US（新进程）。Web 的 context locale 只能新建 context。
**③ 撤销权限**：Android `pm revoke` 后进程被系统杀掉（稍有延迟），不会自己重连 ⇒ 需自动重启（HU 决定）。iOS 26.5 模拟器 `simctl privacy revoke location` **不杀** App（pid、JS context 不变，调用照常）⇒ 自动重启只在 provider 声明会杀进程的平台做。Web `clearPermissions` → `permissions.query` 回到 prompt。
**④ 剪贴板**：iOS `simctl pbcopy` 写入后 App 读取 → 弹「Quiesco Todo に CoreSimulatorBridge からペースト…」确认框，读取一直挂起、App 变 inactive ⇒ `clipboard.set` 必须由原生模块在 App 进程内写（App 读自己写的内容不弹框）；App 写后 `simctl pbpaste` 可读。Android 无 shell 命令，App 进程内读写（expo-clipboard）正常 ⇒ 两端都走原生模块。Web 授予 clipboard-read / write 后 `navigator.clipboard` 读写正常。
**⑤ 离线**：Android `svc wifi disable` + `svc data disable` → NetInfo 立即 offline、外网 fetch 失败；经 `adb reverse` 的 localhost（mock 后端、Quiesco 连接、Metro）不受影响；`enable` 后恢复 online。Web `context.setOffline(true)` → `navigator.onLine` false + `offline` 事件、fetch 失败（Failed to fetch）。iOS 模拟器无设备级断网（agent 拦截，NetInfo 感知不到）。
- 其他：Android 模拟器访问 https://example.com 在线时也报 SSL trust anchor 错误（模拟器证书问题，与本阶段无关）；示例 App 装了 `@react-native-community/netinfo` 12.0.1、`expo-clipboard` 58.0.4（SDK 58 自带版本），iOS 原生临时函数 `spikeOrientation` 实现时改名为正式函数。

## 6.6 实现发现（2026-11-09）
- **Chromium MediaQueryList 的观察者效应**：对某个 MediaQueryList 读 `matches` 会更新它记住的匹配状态；之后媒体特性变化时 Chromium 比较「上次状态」与当前值，没有差异就不派发 change 事件。react-native-web 的 `Appearance` 在模块作用域保存一个 MediaQueryList，`getColorScheme()` 与 `addChangeListener` 共用它 ⇒ 测试工具在 emulateMedia 之后立即调用 `Appearance.getColorScheme()` 会吞掉 App 的 change 事件（useColorScheme 不更新）。新建的 MediaQueryList 互不影响。⇒ 读回一律用新建的 MediaQueryList。
- RN 0.88 iOS 字号倍数表（RCTAccessibilityManager.mm `multipliers`）：xs 0.823、s 0.882、m 0.941、l 1.0、xl 1.118、xxl 1.235、xxxl 1.353、a-m 1.786、a-l 2.143、a-xl 2.643、a-xxl 3.143、a-xxxl 3.571（与 spike 实测一致）。

## 6.6 批次 B 发现（2026-11-09；脚本 spikes/device-state/offline-*.mjs）
- **Web 离线不能用 `context.setOffline(true)`**：它把 Quiesco 自己到 localhost 的已建立 WebSocket 也掐断（readyState 仍是 OPEN，但消息双向都不到达，恢复在线后才补发），新建 WebSocket / fetch 也全部失败。CDP `Network.emulateNetworkConditionsByRule` 的规则同样作用于已建立的 WebSocket。⇒ 与 HU 决定 ② 的「Web 另用 context.setOffline」不同，改为：`context.route('**/*')` 中止页面请求（route 看不到 WebSocket）+ CDP `Network.overrideNetworkState`（只改 `navigator.onLine` 并派发真实 offline / online 事件，不拦请求）+ agent 拦截。目的（浏览器感知离线 + 请求失败）不变。
- **NetInfo web 在 Chromium 上只监听 `navigator.connection` 的 `change`**（有该 API 时不监听 online / offline）。`overrideNetworkState` 吞吐量用 -1 时只有 offline / online 事件；离线时吞吐量设为 0 → downlink 变化 → 真实的 `change` 事件，NetInfo 随之读 `navigator.onLine`。恢复时吞吐量 -1 同样触发 change。
- Android SystemUI demo mode（API 37）：`settings put global sysui_demo_allowed 1` + `am broadcast -a com.android.systemui.demo -e command enter / clock -e hhmm 0941 / battery / network / notifications`，立即生效（截图确认 9:41）；`-e command exit` 退出。
- agent 离线拦截：把新建的 fetch / XHR / WebSocket 指向 `offline.quiesco.invalid`（RFC 6761），失败形式与各平台无网时一致（RN「Network request failed」、浏览器「Failed to fetch」），不伪造错误；装在 network tracker 之前，tracker 报告的仍是 App 请求的原 URL。

## 6.7 批次 A spike（2026-11-09）
- **Android 指纹（API 37 模拟器，HAL `fingerprint-service.ranchu`）**：没有录入命令（`cmd fingerprint` 只有 sync / fingerdown，仅虚拟传感器；`cmd biometric` 无实现）。可行流程：`locksettings set-pin <pin>` → `am start -a android.settings.FINGERPRINT_ENROLL` → `input text <pin>` + Enter → 点「MORE」若干次 → 「I AGREE」→ 屏幕显示「Touch the sensor」后 `adb emu finger touch 1` × 3（「Lift, then touch again」→「Fingerprint added」）→ 「DONE」。按钮用 `uiautomator dump` 按文字找。已录入判定：`dumpsys fingerprint` 中 `"count":N`（N>0）。`locksettings clear --old <pin>` 同时删除所有指纹（count 回到 0）⇒ `enroll(false)` 与恢复都用它。Settings 文字是英文（依赖系统语言，实现时按文字匹配需注意）。
- **iOS Face ID（26.5 模拟器，spikes/system/ios-biometrics.mts）**：`xcrun simctl spawn <udid> notifyutil -s com.apple.BiometricKit.enrollmentChanged 1` + `-p com.apple.BiometricKit.enrollmentChanged` → `isEnrolledAsync` 立即 true（`0` 取消录入）。认证中 `notifyutil -p com.apple.BiometricKit_Sim.pearl.match` → `authenticateAsync` 成功（首次使用没有弹 Face ID 授权框，NSFaceIDUsageDescription 由 plugin 写入）。`pearl.nomatch` → 系统弹「顔を認識できません / Face ID をやり直す / 取消」，App 的 promise 一直挂起；对话框显示期间再发 nomatch 无效 ⇒ 失败结果要靠关闭系统弹窗（批次 C）。弹窗盖住时进程内点击报 ELEMENT_NOT_FOUND（no native view in a window）。
- **Android 指纹匹配**：认证中 `adb emu finger touch 1`（已录入 id）→ 成功；未录入 id（2）→ 系统提示保持（无失败回调），5 次后锁定，App 仍未收到结果 ⇒ 同样要关闭系统弹窗（按钮文字 = App 的 cancelLabel）。
- **iOS keychain**：`simctl keychain <udid> reset` 有效（genp 45 → 2），作用于整台模拟器而非单个 App。
- **shake**：RN 核心没有对外 shake 事件；`react-native-shake` 6.11.0（新架构 codegen，2026-10 更新）iOS 用 motionEnded、Android 用加速度计 —— 与计划的 iOS 原生 motion 事件 / Android `adb emu sensor` 对应。
- 杂项：新 build 安装后最初两次启动，进系统页后立即 native tap 报「no native view in a window」，之后不再复现（未定位，留意）。
- **iOS shake（26.5）**：iOS 26.5 的 UIKitCore 里已没有 `_sendMotionBegan:` / `_sendMotionEnded:`（Detox 的做法；`respondsToSelector` 为 NO）。UIKitCore 有 `com.apple.UIKit.SimulatorShake`（Simulator 菜单 Device > Shake 发的 Darwin 通知，`_simulatorShakeNotificationToken`）⇒ `xcrun simctl spawn <udid> notifyutil -p com.apple.UIKit.SimulatorShake` 由 UIKit 生成真实 motion 事件，react-native-shake 计数 +1。无需原生模块、无私有 API ⇒ 原计划的原生 motionEnded 撤销。
- **Android shake**：react-native-shake 判定 = 3 s 内 8 次超过 1.33 g（13.04 m/s²）的正负翻转（采样间隔 ≥ 20 ms）。`adb emu sensor set acceleration ±20:9.8:0` 交替 12 次（间隔 80 ms）后 `0:9.8:0` 复位 → 计数 +1。仅模拟器。
- **两台同名模拟器**：别的项目（Appium WDA）在 iOS 27 的「iPhone 17」上运行；Quiesco 默认取已启动的模拟器 ⇒ 本项目运行时用 `QUIESCO_IOS_DEVICE='iPhone 17' QUIESCO_IOS_OS=26.5` 固定。
- Metro 缓存：重建 agent 后 Metro 需要 `--clear` 重启，否则 bundle 仍是旧 agent（agent 方法报 -32601 method not found）。
- **Android 认证时机（实现中发现）**：点认证后 `dumpsys fingerprint` 立即出现 `FingerprintAuthenticationClient`（State 4），约 0.5 s 后变为 State 2（BiometricScheduler STATE_STARTED）才接受触摸；更早的 `emu finger touch` 会丢失 ⇒ match / fail 先轮询到 State 2 再触摸（无认证在等待时报 DEVICE_ERROR）。
- **Android 失败后的锁定**：ranchu HAL 每次 `onAuthenticationFailed` 后短暂锁定（约 0.5 s，`onLockoutTimed`），期间的触摸以错误 7「Too many attempts」结束认证；连续失败多次锁定更久（见到约 7 s），计数在 `locksettings clear` 时也不清零（`resetLockout` 报 E_HAT_WRONG_CHALLENGE），成功一次才清。spike 中多次未匹配导致后续运行全部被锁 ⇒ fail() 后下一次触摸至少隔 1 s；文档说明连续失败会锁定。
- **模拟器运行 9.5 h 后过慢**（内部 load 约 8，进程启动到 JS 运行 17 s，连接超时）⇒ 经 HU 同意冷启动。AVD 名称是 `Medium_Phone_API_37.0`；传错名字时 provider 等满 180 s 才报「did not appear」（改进点：启动前用 `-list-avds` 校验并列出可用名称）。
- **dev client 的摇动会打开开发者菜单（iOS）**：全量回归中 system.feature 的摇动场景之后，expo-dev-menu 的菜单面板一直盖在 App 上，values.feature 6 个场景被判为「被另一窗口遮挡」。expo-dev-menu 的 `toggleMenu` 只在 `EXDevMenuMotionGestureEnabled` 为真时打开（UserDefaults，启动参数可覆盖）；`RCTShowDevMenuNotification` 由 RN 核心照常发出，RNShake（Debug）仍收到 ⇒ `IOS_DEV_MENU_ARGS` 加 `-EXDevMenuMotionGestureEnabled NO`。Android 摇动后截图无菜单。

## 6.7 批次 B spike（推送，2026-11-10；spikes/system/ios-push.mts、android-push.mts）
- **iOS `simctl push`**：App 在前台时 expo-notifications 的 received 监听收到（通知权限 `undetermined` 也收到）；无权限时前台不显示横幅、后台主屏幕也不显示（simctl privacy 无 notifications，无法预授权）⇒ 点击通知进入 App 需要先授权 + 点进程外横幅 → 依赖批次 C。
- **Android A（@quiesco/native 以 App 身份 NotificationManager.notify）**：前后台都出现在通知栏；`cmd statusbar expand-notifications` + uiautomator 按标题点击 → App 回到前台；expo-notifications 的 received / response 回调不触发（HU ② 预期）。
- **Android B（反射调用 expo-notifications 的 FirebaseMessagingDelegate.onMessageReceived(RemoteMessage(bundle))）**：调用成功但既无回调也无通知（未初始化 Firebase / 字段格式不明）⇒ 放弃，按 HU ② 用 A。
- App 在后台时 backdoor 15 s 无应答（backdoor 之后等空闲）；正式的 agent 方法 postNotification 不等空闲。
- **Metro `CI=1` 不监听文件**：之前「bundle 是旧的」都是因为用 CI=1 启动 Metro（Expo CLI 在 CI 模式关闭 watch）⇒ 本地实跑改为不带 CI 启动（stdin 重定向 /dev/null 防交互）。
- **平台标签并集 + 继承**：feature 级 @native 被场景继承，与场景的 @android 取并集 ⇒ @android 场景也在 iOS 上跑（批次 A 的「不匹配后再出示匹配的指纹」在 iOS 上也跑过）。示例改为场景级标签；api.md 注明。

- **平台标签改为最内层优先（HU 2026-11-10 确认）**：feature → Rule → 场景 → Examples，最内层带平台标签的层级决定平台（同层多个仍取并集），无平台标签时继承外层。分组靠 cucumber-js Before hook 的 `gherkinDocument` + `pickle.tags[].astNodeId`（`tagLevels`，packages/cucumber）；core 的 `runsOnPlatform` 接受扁平或分层标签。与 cucumber-js `--tags`（含继承标签）不同，api.md 注明。示例 system.feature 改回 feature 级 @native。
- **两台模拟器同时开机**：未指定设备时 iOS provider 取第一台 Booted（5FB8…），该台上生物识别录入不被撤销、`simctl push` 报 UNErrorDomain 2003「Source is not authorized」；旧代码同样失败 ⇒ 与标签改动无关。关掉多余的一台后 iOS 全量通过。改进点：多台 Booted 时警告并列出 udid（或要求指定）。

## 6.7 批次 C spike（Android 系统弹窗，2026-11-10；spikes/system/android-dialogs.mts、android-dialog-appstate.mts）
- **权限对话框是另一个 Activity**（permissioncontroller 的 GrantPermissionsActivity）：点击后约 150 ms RN AppState 变 `background`，JS 线程仍可应答（deviceInfo / getIdleState），但 **RN 定时器暂停** ⇒ agent 的 `waitForIdle`（sleep 用 setTimeout）既不结束也不超时 ⇒ 触发对话框的 `tap()` 卡到 RPC 超时。修复：等待循环同时被 AppState change 事件唤醒；后台且活动 tracker 全空闲时直接返回（不做第二个 macrotask 确认，后台没有定时器 / 帧）。
- **resource-id 与语言无关**：`com.android.permissioncontroller:id/permission_allow_button`、`permission_deny_button`；第二次请求时拒绝按钮变为 `permission_deny_and_dont_ask_again_button`（文字同为 “Don’t allow”，弯引号）。位置权限另有 `permission_allow_foreground_only_button` / `permission_allow_one_time_button`。包名 `com.google.android.permissioncontroller`（id 前缀仍是 com.android.permissioncontroller）。
- 连续拒绝两次 ⇒ flags USER_SET|USER_FIXED，第三次不再弹出；`pm clear-permission-flags <pkg> <perm> user-set user-fixed` 恢复为可再询问。`pm revoke` 杀 App 进程；安装（-g）会授予全部权限 ⇒ 撤销必须在安装后。
- **BiometricPrompt**（fail 后保持显示）：包 `com.android.systemui`，取消按钮 `com.android.systemui:id/button_negative`（文字为 cancelLabel「取消」），另有 `close_button`；点击后 App 收到 `user_cancel`。
- `uiautomator dump` 每次约 2 s（1.9–2.9 s）⇒ 轮询间隔不需要再加等待，超时要按 dump 时间留余量。

## 6.7 批次 C spike（iOS XCUITest 辅助进程，2026-11-10；spikes/ios-xcuitest、spikes/system/ios-system-ui.mts）
- **工程**：无 xcodegen / tuist ⇒ 用 CocoaPods 自带的 xcodeproj gem 生成（GEM_PATH=cocoapods libexec + ruby 默认路径，否则缺 rexml）：空壳 Host App + UI test bundle（TEST_TARGET_NAME=Host，不签名）。`build-for-testing` 约 9 s（首次），产出 `.xctestrun`。
- **运行方式**：`xcodebuild test-without-building -xctestrun … -destination id=<udid> -only-testing:Runner/SystemUIServer/testServe`，环境变量 `TEST_RUNNER_QUIESCO_PORT` 传端口（前缀被去掉）；测试方法里 NWListener（主队列）+ RunLoop 常驻，类似 WebDriverAgent。**启动 2.1–3.8 s**；启动时 App 保持 active（不会被挤到后台）。
- **延迟**：`/nodes` 空闲 ~30 ms、有横幅 ~200 ms、有 alert 570–1170 ms；tap 0.6–1.7 s。
- **通知授权 alert**（SpringBoard）：文字跟随模拟器语言（ja-JP：「許可しない」「許可」），按钮**没有 identifier** ⇒ allow / deny 只能按位置（通知：最后一个 = 允许、第一个 = 不允许；位置权限是三个纵向按钮，需另测）或按本地化文字。点允许后 App 回到 active，`getPermissionsAsync` = granted。
- **Face ID 失败重试 alert**：在 SpringBoard 树里，**有稳定 identifier**：alert `com.apple.localauthentication.ax.authentication.alert`，按钮 `…authentication.button.try-again` / `…button.cancel` ⇒ 与语言无关；点取消后 App 收到 `user_cancel`。
- **通知横幅**（App 在后台、已授权）：SpringBoard 按钮 identifier `ShortLook.Platter.Content.Seamless`，label「今, <标题>, <正文>」；点击后 App 回到 active，expo-notifications 的 response 回调收到标题 ⇒ **iOS openNotification 可实现**。
- **SpringBoard alert 不随 App 重启消失**：上一次运行留下的授权 alert 在 relaunch 后仍在，挡住 App（`no native view in a window`）⇒ 场景间重置要处理残留 alert。
- 代价：依赖 Xcode（xcodebuild，按 Xcode 版本缓存 build-for-testing 产物）；每个会话一个常驻 xcodebuild 子进程；模拟器之外（真机）需签名，留给 6.13。
- **实现后**：`relaunch({ reinstall: true })` 在 iOS 模拟器上把通知权限恢复为「未决定」（实跑确认）；残留 alert 在场景重置时按 cancel → deny → 第一个按钮关闭。

## Web alert / confirm spike（2026-11-10；spikes/web-dialogs/dialogs.mts，Playwright 1.65）
- 注册 `page.on('dialog')` 后 Playwright 不再自动关闭 dialog；`confirm()` 调用后约 14 ms 收到 dialog 事件（type / message / defaultValue）。
- dialog 未处理期间：`page.mouse.click` 不返回、`page.evaluate` 被阻塞（页面 JS 冻结 ⇒ agent RPC 也不返回）。`dismiss()` 后 click 立即 resolve，页面得到 `false`。
- `beforeunload` 同样被监听器挡住，`page.goto` 一直等到它被处理 ⇒ Quiesco 自己的导航（relaunch / reload）必须自动接受 beforeunload。
- 实现中补测：dialog 打开时 `page.screenshot()` 一直等（页面不绘制）⇒ provider 截图时直接报 DIALOG_OPEN；`context.close()` 不受影响（4 ms）。
- `dialog.accept()` 不带参数时 prompt 提交空字符串（不是默认值）⇒ 接受 prompt 时显式传 `defaultValue()`。
- HU 确认方案（2026-11-10）：dialog 保持打开，作为系统节点（dialog.message / accept「OK」/ dismiss「Cancel」）经 `app.device.system.*` 回答；引发 dialog 的动作在 dialog 出现时即返回；dialog 打开时其他调用立即 DIALOG_OPEN；场景间残留的自动取消并警告。未加 `web.dialogs` 配置项。

## 6.8 WebView spike（2026-11-10，spikes/webview/）
- react-native-webview 14.0.1（Expo 自带版本）：Web 只渲染「does not support this platform」；`<WebView>` 的类型默认 `P = undefined` 使 props 为 never → 示例写 `WebView<object>`。ref 是 imperative handle，`findNodeHandle` 不可用 ⇒ 正式实现由 fiber-adapter 找宿主 view 的 tag（原生侧在子视图里找 WKWebView / android.webkit.WebView）。
- 原生 `webviewEval`：iOS `evaluateJavaScript` 往返 **~50 ms**；Android `evaluateJavascript` **120–375 ms**（模拟器，经 backdoor）。页面脚本抛错时 iOS 只给本地化的笼统信息（「JavaScriptの例外処理が起きました」），Android 静默返回 "" ⇒ **脚本一律在页面里 try/catch，结果包成 JSON `{v}` / `{e}`**。
- 坐标：`getBoundingClientRect()`（CSS px）× (WebView 宽 / innerWidth) + WebView 在窗口中的位置 = 窗口坐标（iOS f=1，Android f≈1.001，inset 0）。真实点击（现有 tapAt / 原生触摸）命中 input（焦点到 #name）、button、`<a href="#faq">`。点击前必须 `scrollIntoView`（页面被滚走时点到外面）。
- 输入：iOS 原生 typeText 找不到 WKWebView 的文本输入（E_NOT_TEXT_INPUT）；**聚焦后 `document.execCommand('insertText')` 两端都能输入并触发 input 事件** ⇒ 采用（真实点击聚焦 + insertText）。
- 文档开始脚本：iOS `WKUserScript(.atDocumentStart)`、Android `WebViewCompat.addDocumentStartJavaScript`（模拟器 WebView 支持 DOCUMENT_START_SCRIPT）都只作用于之后的加载，两端在重载后的页面都执行了 ⇒ 首次发现 WebView 时「注册 + 对当前页 eval 同一钩子」。fetch 计数实测：点击后 1 → 请求结束 0；页内 setTimeout 不计（断言本身会重试）。
- `source={{ html }}` 的页面重载后是空白 about:blank。Android `WebView.url` 不含 hash ⇒ `url()` 用页面里的 `location.href`。
- Web：`<iframe srcdoc>` 经 `elementHandle.contentFrame()` 可用，fill / click / textContent / xpath / getByText / scrollIntoViewIfNeeded / evaluate 都正常；agent 查到的 iframe 宿主元素 props 里带 `ref`（含 fiber，循环巨大）⇒ 元素摘要要过滤 `ref`。

## 6.9 证据与诊断 spike（2026-11-10，spikes/artifacts/video-logs.mts）
- iOS 录像：`simctl io <udid> recordVideo --codec=h264 --force f.mp4`，stderr 出现「Recording started」用时 190–280 ms；SIGINT 停止 10–20 ms，得到完整 MP4（ftyp + moov）。两轮连续可用 ⇒ 按场景启停。
- Android 录像：`adb shell screenrecord --bit-rate 4000000 /sdcard/x.mp4`（无输出，以 `pidof screenrecord` 判断已启动，~60 ms）；`pkill -INT screenrecord` 后进程退出时文件才写完，pull + rm 合计 0.5–0.6 s，MP4 完整。单段上限 3 分钟（`--time-limit` 默认 180 s）⇒ 场景超过时接续下一段。
- Web 录像：Playwright 1.65 `page.screencast.start({ path })` / `stop()`，启动 ~1 ms、停止 ~40 ms，得到 WebM（EBML 头）⇒ 按场景启停，不需新 context。console 用 `page.on('console')`。
- iOS 日志：`simctl spawn <udid> log stream --style compact --predicate 'process == "<可执行名>"'`；`--level debug` 3 s 71 行，大部分是 BackBoard 等系统子系统的噪声 ⇒ 默认用 info 级别。
- Android 日志：`pm list packages -U <pkg>` 取 uid，`logcat -v threadtime -T 1 --uid=<uid>`（App 重启后 pid 变但 uid 不变），3 s 8 行，含 ReactHost 生命周期、原生警告。
- 整页截图：agent 已有 Scrollable（offset / viewport / content / scrollTo），可按屏滚动；拼接在 core 用 png.ts 完成（第一屏取滚动区底边以上全部，后续每屏取新露出的条带，最后一屏补滚动区以下的固定区）；虚拟列表边滚边变长，以 offset 不再变化为结束。
- 实现补充：RN-web 的 ScrollView 是普通 div（无 scroll 语义类型）⇒ 默认滚动容器按 clipsContent 节点里面积最大的找；Android 滚动后滚动条会显示一段时间、每屏截图都带上 ⇒ 原生 setScrollIndicators 截图期间隐藏、结束后恢复原状态；iOS log stream 里 com.apple.Accessibility 约占 60% ⇒ 过滤掉。

## 6.10 网络同步 spike（2026-11-11，spikes/network/network.mts + server.mjs，临时 backdoor netProbe）
- 测法：每种请求 1.5 s，看 agent 回答 backdoor 前的空闲等待时长（runtime 在 backdoor 后 waitForIdle）+ tracker begin/end 时刻。注意：backdoor 本身会等空闲，第一版 spike 在 backdoor 之后再测，误判为「全部看不到」。
- 结果（iOS 26.5 / Android 模拟器 / Chromium，三端一致，Web 例外已注明）：

| 请求 | iOS | Android | Web |
|---|---|---|---|
| 全局 fetch，响应头慢 | ✅ 1565 ms | ✅ 1583 ms | ✅ 1519 ms |
| 全局 fetch，响应体慢（头立即到） | ❌ 2 ms 就 end | ❌ 19 ms | ❌ 1 ms |
| `import { fetch } from 'expo/fetch'` | ❌ 完全没跟踪 | ❌ | ✅（web 版 = globalThis.fetch） |
| expo/fetch，响应体慢 | ❌ | ❌ | ❌ 1 ms |
| XHR | ✅ | ✅ | ✅ |
| WebSocket 握手 1.5 s | ❌ 不跟踪 | ❌ | ❌ |
| EventSource | 无此全局 | 无此全局 | ❌ 不跟踪 |

- 全局 fetch 确实是 Quiesco 的包装（name 为空、非 getter）⇒ agent 安装时 winter runtime 的 lazy getter 已经被读取 / 覆盖过，没有出现「Expo 之后重新覆盖」的问题（源码推测不成立）。原生端包装的底层就是 expo/fetch：它在响应头到达时 resolve（body 流式读），所以 tracker 在 `await res.json()` 期间已判空闲 ⇒ **Detox #4973 的同类问题在 Quiesco 表现为「响应体阶段失明」+「直接 import expo/fetch 完全失明」**。
- expo/fetch 的导出：`expo/fetch` → `src/winter/fetch/index.ts` 的 `export *`，实测为 getter、configurable=false、无 setter（iOS）⇒ 运行时改不了，只能在打包阶段处理（withQuiesco 的 Metro resolver 把 App 代码里的 `expo/fetch` 指到 Quiesco 的包装模块）。
- iOS spike 第一轮挂起：SSE 用例后 dispose 卡住（iOS 无 EventSource，挂在别处），与网络跟踪无关，按 Ctrl-C 处理。
