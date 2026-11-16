# Findings: Expo SDK 55–57

## 现状（2026-11-16）
- 写死 SDK 58 的文档：README、docs/{,zh/,ja/}quickstart、example-app、detox-comparison、known-issues（这些是「Seen with」，不用改）、packages/agent/README、plugin/README、plugin/skills/setup/references/quickstart.md。
- `doctor` 只检查有没有 expo 依赖，不看版本（packages/cli/src/commands/doctor.ts:82）。
- CI（.github/workflows/ci.yml）：build / lint / depcruise / 单元测试 / typecheck 示例，没有 e2e。
- `scripts/check-prod-strip.mjs` 注释：复制的工程里 symlink 的模块会被 autolinking 过滤 ⇒ 兼容工程用 tarball 安装。

## 各 SDK 自带版本（bundledNativeModules.json）
| SDK | react | react-native | expo-router | RNGH | screens | webview |
|-----|-------|--------------|-------------|------|---------|---------|
| 55 | 19.2.0 | 0.83.10 | ~55.0.18 | ~2.30.0 | ~4.23.0 | 13.16.0 |
| 56 | 19.2.3 | 0.85.3 | ~56.2.22 | ~2.31.1 | ~4.26.0 | 13.16.1 |
| 57 | 19.2.3 | 0.86.3 | ~57.0.31 | ~2.32.0 | ~4.26.0 | 13.16.1 |
| 58 | 19.3.0 | 0.88.1 | ~58.0.31 | ~3.3.0 | ~4.30.1 | 14.0.1 |

## 示例 App 用到的「新 SDK 才有」的东西（只影响示例，不是 Quiesco 的问题）
- `src/app/gestures.tsx` 用 RNGH 3 hook API（usePanGesture 等）；55–57 是 RNGH 2 ⇒ 兼容工程换成 builder API（`scripts/sdk-compat/overlays/rngh2/`）。
- `useHeaderHeight` 从 `expo-router/react-navigation` 导入：56+ 才有这个入口；55 的 expo-router 依赖 React Navigation ⇒ 换成 `@react-navigation/elements`。
- 示例原先靠 @types/ws 间接引入 node 类型（TS 6 默认 `types: []`）⇒ 示例 tsconfig 明确 `types: ["node"]` 并加 `@types/node` devDependency。

## 兼容工程（scripts/sdk-compat.mjs）
- 复制的工程用 npm 装 tarball：`workspace:*` → `file:`，并作为 overrides；`.npmrc legacy-peer-deps`（datetimepicker 的可选 peer react-native-windows 要 RN 0.85，与 SDK 55 冲突）。
- `expo install --fix` 会把 jest 降到 29、typescript 降到 5.9 ⇒ `expo.install.exclude: [jest, typescript]`。

## 环境：Xcode 27.2 + SDK 55
- `xcodebuild` 失败：SDWebImage（9.0）、RNCAsyncStorage 资源 bundle（13.4）的 IPHONEOS_DEPLOYMENT_TARGET 低于 Xcode 27 支持的 15.0。与 Quiesco 无关（用户在新 Xcode 上用旧 SDK 同样会遇到）。绕过：xcodebuild 加 `IPHONEOS_DEPLOYMENT_TARGET=15.1`。
- Android：SDK 55 dev client 构建成功（@quiesco/native 在 expo-modules-core 55 上编译通过）。

## SDK 55 原生实跑（2026-11-16）
### Android：92 场景 31 通过 / 4 失败 / 57 跳过（连续 3 次相同失败后 bailOnRepeatedFailure）
**① rect 偏 24dp（状态栏高度）**——「按屏幕坐标点击」点不中（rect y 184，实际 208；login-screen rect y = -24）。
- 根因：`getBoundingClientRect` 含 viewportOffset = `RootViewUtil.getViewportOffset(rootView)`。RN 0.83 / 0.85 无条件减 `getWindowVisibleDisplayFrame().top`（edge-to-edge 下根视图在 window 0，结果 -24dp）；RN 0.86+ 只在非 edge-to-edge 时减状态栏 inset。⇒ SDK 55、56 受影响，57、58 正常（edge-to-edge）。
- Quiesco 原生端按 window 坐标注入（tapAt：decorView；tap(tag) 用 getLocationInWindow 所以普通点击不受影响）。受影响的还有：tapAt、按 rect 算的 gesture 起点、元素截图裁剪、可见性 / 视口判断、报给用户的 rect。
**② 带深链接的重启连不上**（lifecycle.feature 3 个场景）：Android dev client 用 `<deeplink>?__expo_url=<metro>&…` 冷启动，这是 expo-dev-launcher 58 才支持的格式（55.0.42 / 56.0.29 / 57.0.22 源码里没有 `__expo_url`）⇒ 停在 dev launcher 首页。iOS 不受影响（URL 作为启动参数由 @quiesco/native 交给 App，`needs-native`）。

### iOS：Xcode 27.2 上 SDK 55 构建
- 先报 SDWebImage / RNCAsyncStorage 资源 bundle 部署目标 < 15.0；全局覆盖 15.1 后又报 expo-router 55 `LinkPreviewNativeActionView.swift:141` `subtitle` 需 iOS 16 ⇒ Expo 上游与 Xcode 27 的不兼容。
- 解决：`Podfile.properties.json` `ios.deploymentTarget = 16.0` + post_install 把低于 16.0 的 Pod 抬到 16.0 + App target 16.0 ⇒ BUILD SUCCEEDED。用户侧对应：expo-build-properties `ios.deploymentTarget: "16.0"`。

### 后续发现（2026-11-16 晚）
- **@quiesco/native 在 SDK 55 的 iOS 上被静默排除**：podspec `platforms ios 16.4`，SDK 55 模板默认部署目标 15.1（56–58 是 16.4）⇒ autolinking 跳过、不报错，Quiesco 退化为 js 模式。⇒ podspec 降到 15.1。
- **SDK 55 App 在 iOS 27 模拟器启动即崩**：`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`（iOS 27 要求 UIScene 生命周期，SDK 55 模板未采用）⇒ SDK 55 在 iOS 26.5 模拟器上验收（`QUIESCO_IOS_OS=26.5`）。平台与 Expo 版本的问题，写进 known-issues。
- **rect 校正第一版没生效**：第一个顶层 host 被 Fabric 扁平化，`locate` 找不到 ⇒ 改为广度优先最多试 8 个有原生 view 的节点。
- **Android dev-menu 引导页盖住 App**（windowHasFocus false ⇒ 全部 ELEMENT_OBSCURED）：expo-dev-menu < 58 不认 URL 里的 `__expo_disable_*`，只读 SharedPreferences（55 没有 meta-data 默认值）；`pm clear` / 首次安装后引导页出现。⇒ core 启动 dev client 前，设置文件不存在时用 `run-as` 写入（isOnboardingFinished / showsAtLaunch / showFab / motionGestureEnabled，与 iOS 的 IOS_DEV_MENU_ARGS 对应）。
