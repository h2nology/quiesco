# Task Plan: 处理 GitHub issues #92–#96（0.11.0 之后）

## Goal
解决 h2nology/quiesco 的 5 个 open issue（0.11.0 上的实测反馈：iOS Face ID 弹窗、native-module tracker 两个改进、init --upgrade、doctor）。每个修复配单元测试、必要时更新三语文档；实跑验收后回复并关闭 issue，然后发版。

## Next Step
等 HU `pnpm -r publish`（0.12.0，本地提交 67cc9a1 未 push）⇒ tag v0.12.0、push main + tag、GitHub Release ⇒ 回复并关闭 #92–#96。

## Current Phase
N.D 收尾（进行中）

## 背景
- 前置：0.11.0 已发布（0dbc1ef）。上一轮：`.planning/2026-11-20-issues-82-87/`。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md`：先出计划再写代码；测试与 step 禁止 sleep；宣称完成前实跑验收；每阶段验证完自动提交 + 开 PR；用户个人信息不写进包。
- 摘要与代码定位见 findings.md。

## Issue 一览
| # | 类型 | 内容 | 阶段 | 紧急度 |
|---|------|------|------|--------|
| 92 | bug | iOS 开机后第一个 Face ID 弹窗只在 LocalAuthenticationUIService 的树里，system.tap 找不到 | N.A | 高 |
| 95 | bug | init --upgrade 把精确版本改成 ^ 范围，并加回用户删掉的 e2e:* scripts | N.B | 中 |
| 96 | 改进 | doctor：有 app.config.ts 时 app IDs 检查永远 warn；用 expo config 解析 | N.B | 低 |
| 93 | 改进 | native-module tracker：打开原生对话框（权限、日期选择）的操作总要等满 2 s | N.C | 中 |
| 94 | 改进 | native-module tracker 默认关，#67 竞态静默失败；更容易开、失败证据里可见 | N.C | 中 |

## 决定事项（2026-11-21 HU 已确认：全部按推荐，D3 选「包裹时默认开」）
| ID | 问题 | 推荐 |
|----|------|------|
| D1 | #92 怎么修 | 按 issue 建议：`com.apple.LocalAuthenticationUIService` 加进 `OTHER_APPS`（每次多一次 /elements 读取，15–55 ms，仅系统 UI 路径） |
| D2 | #93 范围 | 做 issue 建议 2+3：内置默认 `ignore` 清单（Expo 权限请求 `*.request*PermissionsAsync`、`PermissionsAndroid`、`RNCDatePicker`/`RNDateTimePicker`、`ExpoLocalAuthentication.authenticateAsync`、Share 等），与用户的 `ignore` 合并，可用 `defaultIgnore: false` 关；timeline 的 `wait for idle` 带上 busy 描述（哪个 tracker / 哪个原生调用）。建议 1（按窗口焦点 / AppState 停止计数）不做：Android 的 DatePicker 是同一 Activity 的 Dialog，AppState 不变，不可靠 |
| D3 | #94 默认开关 | 构建已包裹（`withQuiesco(config, { nativeModules: true })`）时 tracker **默认开**，`sync.trackers['native-module']: false` 仍可关（打包开关本身就是 opt-in；D2 解决了对话框代价）。另一选择：保持默认关，只让 doctor 在两处只设一处时 warn |
| D4 | #94 可见性 | tracker 关但构建包裹时，包裹层仍记录 pending 调用但不计 busy；失败证据 `idle-state.json` 和 timeline 列出「动作返回时仍 pending 的原生调用（未计入：tracker 关）」。doctor 加「只设了一处」的 warn（读 metro.config 是否有 `nativeModules: true` 与 quiesco.config 的 trackers） |
| D5 | #95 怎么修 | 现有 spec 是精确版本 ⇒ 用 pm 的 exact 参数（npm/pnpm `--save-exact`，yarn/bun `--exact`）；`--upgrade` 不再调用 `ensureScripts`（只在首次 init 加 scripts） |
| D6 | #96 + 版本 | 有动态 app config 时在 app 目录跑 `expo config --json --type public`，用结果比对 IDs / scheme（plugins 检查也用它，若 public 输出含 plugins）；失败则保留现有 warn。全部做完一起发 **0.12.0**（D3 改默认行为 ⇒ minor） |

## Phases

### N.0 调研与计划
- [x] 读 5 个 issue，写 findings
- [x] 代码定位
- [x] HU 确认 D1–D6（全部按推荐）
- **Status:** complete

### N.A iOS Face ID 弹窗：#92
分支 fix/ios-local-auth-ui。
- [x] OTHER_APPS 加 LocalAuthenticationUIService；systemNodeReread 对它重读其元素树（15–55 ms，保留 #87 稳定检查）；单元测试；文档三语
- [x] iOS 实测：重启模拟器后 system:39 修复后 3/3 通过；无修复基线失败（复现 issue）；system.feature 回归 15/4/0；`pnpm check` 1000
- [x] PR #97
- **Status:** complete

### N.B CLI：#95 #96
分支 fix/cli-upgrade-and-doctor-config。
- [x] installPackages 按现有 spec 选 exact 参数（四种 pm；全部 Quiesco 包都精确才算）；upgrade 不再 ensureScripts，改为 `=` 行列出 init 会加的
- [x] doctor 动态 config 走 `expo config --json --type public`（EXPO_PUBLIC_QUIESCO=1，每次 doctor 只跑一次），app IDs 与 config plugin 都用；失败回退 warn
- [x] 单元测试 + 文档三语 + plugin refs；`pnpm check` 1003；docs:check ok
- [x] 实测：npm --save-exact 行为确认；临时项目 upgrade --dry-run；todo-app 临时 app.config.ts 的 doctor ✅/❌/⚠️
- [x] PR #98
- **Status:** complete

### N.C native-module tracker：#93 #94
分支 feat/native-module-defaults。
- [x] 默认 ignore 清单（agent DEFAULT_IGNORED_NATIVE_CALLS）+ `ignoreNativeCalls` 追加 / `defaultIgnoreNativeCalls: false` 关闭
- [x] SyncEngine 记录最后一次 busy 的原因 ⇒ 结果 `syncBusy` ⇒ timeline trace args / HTML
- [x] 包裹时默认开（D3）；关时仍记录不计，动作结果 `nativeCallsNotCounted` ⇒ timeline + idle-state.json（D4）；doctor：config 开但 Metro 未包裹 ⇒ warn
- [x] 单元测试 + 文档三语 + plugin refs；`pnpm check` 1006；docs:check ok
- [x] 实测 Android values:46：默认 294 ms；关默认清单 2146 ms 且 timeline 写 RNCDatePicker.open；tracker 关 ⇒ notCounted 列出。登录场景未复现竞态（概率性）。包裹构建回归 Android 26/8、iOS 28/5
- [x] PR #99
- **Status:** complete

### N.D 收尾
- [x] 全量实跑（默认 Metro，main+#99）：iOS 102/7/0；Android 99/9/1（模拟定位：AOSP 无 Play services SERVICE_INVALID，已知环境问题）；web 85/24/0
- [x] 按序合并 PR #97 → #98 → #99（#99 合入 main 无冲突，check 1011，CI 全过）
- [x] 版本 0.12.0、release:check（clean、1011 tests、12 包）、本地提交 67cc9a1（未 push）
- [ ] HU publish ⇒ tag、push、GitHub Release
- [ ] 回复并关闭 #92–#96
- **Status:** in_progress

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| iOS 实测 app 未连上 ws (90 s) ×3 | 1 | 没起 Metro：先 pnpm start:e2e（8082） |
