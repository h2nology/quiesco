# Progress Log

## Session 1 — 2026-11-07
- 通读 `requirements.md`。
- 用 planning-with-files 初始化命名计划 `.planning/2026-11-07-quiesco/`（按 HU 要求不放根目录）。
- 将 requirements.md 第 10 节的 6 个阶段（Phase 0〜5）写入 task_plan.md，Phase 0 细化为 0.0 环境盘点、0.1 spike App、S1〜S7、0.9 汇总。
- 列出 §11 待 HU 决定事项及需要决定的时间点。
- 状态：等待 HU 确认 Phase 0 实施计划。

- HU 确认第 0 阶段计划，开始执行。
- 0.0 环境盘点完成，结果写入 findings.md。重要发现：
  - SDK 58（RN 0.88.1）为 latest；SDK 55 起 New Architecture 强制启用。
  - RN 0.88 移除了 `InteractionManager` → 需求 §6.2-4 需调整（已列入决策候选，待 HU 确认）。
  - iOS 默认 SceneDelegate；新版 Expo Go 尚未上架。
- HU 决定：交互空闲 tracker 改为 idle-callback（rIC + 旧版 InteractionManager 兼容），已同步 requirements.md §6.2-4。
- 0.1 进行中：`spikes/spike-app/` 已用 create-expo-app（blank-typescript, SDK 58）创建，并安装 expo-dev-client、react-dom、react-native-web、@expo/metro-runtime、RNGH 3.3.0。
- 0.1：创建本地 Expo Module `modules/spike-touch`（ios/android，`ping()`；web 端为纯 JS 桩），测试画面 App.tsx（Pressable / RNGH RectButton / 计数器，均带 testID），app.json 设置 bundleId/package `dev.quiesco.spike`、scheme `quiescospike`、expo-dev-client 插件；`.gitignore` 加 /android /ios（CNG）。tsc 通过。
- 启动 AVD `Medium_Phone_API_37.0`（API 37），后台执行 `expo run:android`。
- Android：`expo run:android` 构建成功（51s），安装 dev client；授予 ACCESS_LOCAL_NETWORK 后，用 dev client 深链接加载 Metro bundle（869 modules），测试画面渲染正常，`Native module: android` 证明本地模块已链接。✅
- 踩坑记录：截图全黑（屏幕休眠）、ACCESS_LOCAL_NETWORK 弹窗、dev 菜单、`&` 转义、`uiautomator dump` 卡住 → 已写入 findings。

- Web：同一 Metro 提供 web bundle，Playwright Chromium 渲染成功；testID → `data-testid`。✅
- iOS：`expo run:ios` 因 usbmuxd 失败 → 改用 xcodebuild + simctl install 成功；`simctl openurl` 被 iOS 系统确认框挡住 → 改用 dev-launcher 的 `--initialUrl` 启动参数，渲染成功（`Native module: ios`）。✅
- **0.1 完成**（三端均渲染 spike 画面，本地原生模块在 iOS/Android 已链接）。

- S1：写了 `spike/devtools-hook.ts`（已有 hook 就包装，没有就自装）、`spike/fiber-query.ts`（遍历宿主组件、按 testID 查找、收集文本）、`spike/measure.{native,web}.ts`、`spike/s1-report.ts`；`index.ts` 第一行 import hook。Metro 改为监听模式重启。
  - 第 1 次：`getPublicInstanceFromInternalInstanceHandle` 报 undefined → shim 是 ESM default export，改成 `.default` 后成功。
  - Android / iOS debug 均通过（详见 findings）。
- S1：Android release（`gradlew assembleRelease`，1m23s）安装后 `hookSource=installed`、`bundleType=0`，4/4 命中、坐标与 debug 相同。
- **S1 完成**，结论写入 `docs/spikes/01-fiber-query.md`。

## Test Results
| 测试 | 结果 | 备注 |
|------|------|------|
| 0.1 Android dev client 渲染 spike 画面 | ✅ | API 37 Emulator，截图确认 |
| 0.1 Web（Chromium）渲染 spike 画面 | ✅ | playwright 1.65.0，截图 scratchpad/web-01.png |
| 0.1 iOS Simulator 渲染 spike 画面 | ✅ | iPhone 17 / iOS 27.0，`--initialUrl` 启动 |
| S1 Android debug：按 testID 查询 + 坐标 | ✅ | 4/4 命中，坐标与截图误差 ≤1px |
| S1 iOS debug：按 testID 查询 + 坐标 | ✅ | 4/4 命中，坐标与截图吻合 |
| S1 Android release：自装 hook | ✅ | hookSource=installed，4/4 命中 |
