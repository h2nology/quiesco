# Progress: Expo SDK 55–57

## 2026-11-16
- 回填原计划「待 HU 决定」第 5 项（npm org / 发布流程）。
- 盘点现状，HU 确认方案（全量复制 todo-app 验证、CI Web 矩阵、doctor 报错 / init 警告）。
- C.1：`scripts/sdk-compat.mjs` + overlays；SDK 55 / 56 / 57 工程生成、tsc 通过。
- SDK 55 Web 全量：92 场景，79 通过、13 跳过（平台标签），0 失败（1m29s）。
- C.4：`packages/cli/src/expo-sdk.ts`（MIN_EXPO_SDK 55）；doctor 低于 55 报 fail、init 警告；`test/expo-sdk.test.ts` 4 个测试通过。
- C.5：`.github/workflows/sdk-compat.yml`（Web 矩阵 55–58）已写，未在 GitHub 上跑过。
- SDK 55 Android dev client 构建成功；iOS 需 `IPHONEOS_DEPLOYMENT_TARGET=15.1`（见 findings），重新构建中。
- SDK 55 Android 首轮：31 通过 / 4 失败（tapAt 偏 24dp；深链接重启 ×3）后 bail。原因见 findings。
- HU 决定 4（rect 统一校正）、5（Android 深链接交给原生模块）。
- 实现：fiber-adapter `calibrateCoordinates` + runtime 每次调用前校正（只用现有 `locate`，不改原生）；Android 原生 `deliverLaunchUrl`（反射写 ExpoLinkingModule.initialURL）+ core 改为 `expo-development-client/?url=` + `--es quiescoUrl`；podspec iOS 15.1；core 启动前预置 dev-menu 设置；sdk-compat 加 Xcode 27 用的 config plugin（SDK < 56）。单元测试：agent 345、core 294 通过。
- iOS 首轮 SDK 55：iOS 27 上启动即崩（UIScene）⇒ 改用 iOS 26.5；第二轮全是 js 模式失败（原因：podspec 16.4 被跳过）。
- Android 深链接：expo-router 在 Android 上读 RN `Linking.getInitialURL()`（activity intent 的 data），不读 expo-linking ⇒ 原生端在模块创建时把 activity intent 的 data 换成深链接（同时写 expo-linking）。手动验证：冷启动直接进入生命周期页。重装后首次启动 extras 全丢（既有现象，LaunchParamsStore 注释），不影响测试流程。
- **SDK 55 Android 全量：92 场景 86 通过 / 6 跳过 / 0 失败（5m29s）。**
- SDK 55 iOS（26.5）全量：85 通过 / 1 失败——无障碍自定义动作：RN 0.83 iOS 用 action 的 name 命名 UIAccessibilityCustomAction，0.88 用 label ⇒ 原生端按 label 或 name 匹配。修复后 values.feature 11/11 通过。
- SDK 56：Xcode 27 下 Pod 部署目标同样过低 ⇒ config plugin 参数化（55：app + pods 16.0；56–57：pods 16.4）。Web 79/0、Android 86/0、iOS 26.5 86/0（iOS 27：UIScene 启动即崩）。
- SDK 57：Web 79/0、Android 86/0、iOS 26.5 86/0（iOS 27：同上）。known-issues 改为「SDK 55–57 on Xcode 27 / iOS 27」。
- SDK 58 回归（重建示例 App）：Web 79/0、Android 86/0、iOS 86/0。但 Android 7m01（热）vs 关闭校正 5m22 ⇒ 每次调用前 locate 太重（+30%）⇒ 改为窗口尺寸变化时或每秒最多一次（CALIBRATION_INTERVAL_MS）⇒ 5m24。
- 节流后 SDK 55 Android 再跑：86/0（5m26）。
- 提交 5 个 commit，PR #43。CI 全部通过：ci、docs、Mintlify；sdk-compat SDK 55 / 56 / 57 / 58（web，Linux + Chromium，各 3–4 分钟，首次运行）；prod-strip web / android / iOS。
- GitHub 合并接口两次 502（PR 停在 OPEN、main 未变）⇒ HU 指示直接本地合并：`git merge --no-ff` 推送 main（e6e3a65），PR #43 自动标记 MERGED。删除分支 feat/expo-sdk-55-57（本地和远端）。
