# Task Plan: 支持 Expo SDK 55–57

## Goal
最低支持 Expo SDK 从 58 下调到 55（55 / 56 / 57 / 58 都正式支持）：示例 App 的全量 feature 在每个 SDK × 三端（iOS / Android / Web）实跑通过；CI 加 Web 冒烟矩阵；doctor / init 检查 SDK 版本；文档三语改为「SDK 55+」。

## Current Phase
C.7 验收（本地完成；CI 矩阵待推送后在 GitHub 上首次运行）

## Next Step
HU 确认后提交；推送分支让 `sdk-compat` workflow 在 GitHub 上首次运行（Linux 上的 Web 实跑未验证过）。

## 背景
- 原计划 `.planning/2026-11-07-quiesco/` §11-2：SDK 58，「Phase 4 CI 冒烟 55–57 后可再下调」——冒烟一直没做。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md`「工作约定」。和 HU 交流用中文。
- 现状：agent peer `react >=19.2`、`react-native >=0.83`（SDK 55 起已满足）；native peer `expo: *`；agent 已兼容旧版 `InteractionManager`；CI 不跑任何 e2e。
- npm：expo 55.0.32 / 56.0.24 / 57.0.33。

## HU 决定（2026-11-16）
1. 验证方式：复制 `examples/todo-app` 降到 55 / 56 / 57，三端各跑全量 feature；示例用了只有 58 才有的 API 时，用 SDK 标签跳过（并写明原因）。
2. CI：加 Web 冒烟矩阵（SDK 55–58，Linux + Chromium）；iOS / Android 只本地验收。
3. 版本检查：`quiesco doctor` 在 expo < 55 时报 error（55 起强制 New Architecture），`init` 照常生成但打印警告。
4. （SDK 55 实跑后）Android rect 偏 24dp（RN 0.83 / 0.85）：agent 统一校正——@quiesco/native（Android）提供 JS 坐标 → window 坐标的差值（用 RN 自己的 RootViewUtil 算，不按版本号分支），fiber-adapter 给所有原生 rect 加上；报出的 rect、tapAt、截图裁剪、可见性与 SDK 57 / 58 一致。
5. （同上）Android 带深链接冷启动：和 iOS 一样交给原生模块——URL 作为 intent extra 传入，@quiesco/native 在 JS 启动前把它设成初始 URL；dev client 照常用 `expo-development-client/?url=` 启动；先 spike。

## Phases
### C.0 调研与计划
- [x] 现状盘点（写死 58 的地方、peer 范围、CI）
- [x] HU 确认方案（2026-11-16）

### C.1 兼容工程脚本
- [x] `scripts/sdk-compat.mjs`：`pnpm build` → 各包 `pnpm pack` → 把 todo-app 复制到仓库外 / gitignore 目录，`workspace:*` 换成 tarball（不用 symlink：autolinking 会过滤，spike 06 §3）→ expo 设为目标 SDK → `npx expo install --fix` → `npm install`
- [x] SDK 55 Web 全量跑通（先暴露 JS 层问题）

### C.2 SDK 55 原生（Android / iOS）
- [x] 构建 dev client（Android 直接成功；iOS 需部署目标 16.0，见 findings）
- [x] rect 校正（决定 4；每次调用前 → 窗口尺寸变化或每秒最多一次）
- [x] Android 深链接冷启动交给原生模块（决定 5：activity intent data + expo-linking）
- [x] sdk-compat.mjs：Xcode 27 用 config plugin（55：app + pods 16.0；56–57：pods 16.4）
- [x] 全量 feature；另修：podspec iOS 15.1、dev-menu 设置预置（Android）、iOS 无障碍自定义动作按 name 或 label 匹配

### C.3 SDK 56、57 三端全量（完成）

### C.4 doctor / init 版本检查 + 单元测试（完成）

### C.5 CI Web 冒烟矩阵（55 / 56 / 57 / 58）（已写，未在 GitHub 上运行）

### C.6 文档三语 + plugin skill 引用；README / quickstart / agent README；known-issues 补版本差异（完成；CONTRIBUTING 加 sdk-compat）

### C.7 验收：4 个 SDK × 三端全量结果表、pnpm check、docs:check；回填原计划 §11-2
| SDK | RN | Web（Chromium） | Android（API 37） | iOS |
|-----|----|-----|---------|-----|
| 55 | 0.83.10 | 79 / 0 失败 | 86 / 0 失败（5m26） | 86 / 0 失败（26.5，4m45） |
| 56 | 0.85.3 | 79 / 0 | 86 / 0（5m48） | 86 / 0（26.5，4m36） |
| 57 | 0.86.3 | 79 / 0 | 86 / 0（5m52） | 86 / 0（26.5，4m35） |
| 58 | 0.88.1 | 79 / 0 | 86 / 0（5m24） | 86 / 0（27.0，5m09） |
（92 场景；跳过的是平台标签。）pnpm check：889 测试通过；docs:check 通过；原计划 §11-2 已回填。

## Errors Encountered
| 错误 | 次数 | 处理 |
|------|------|------|
