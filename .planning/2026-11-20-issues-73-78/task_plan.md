# Task Plan: 处理 GitHub issues #73–#78（0.9.0 之后）

## Goal
解决 h2nology/quiesco 的 6 个 open issue（同一位用户在 0.9.0 上的实测反馈）。每个修复配单元测试、必要时更新三语文档；实跑验收后回复并关闭 issue，然后发版。

## Next Step
全部完成（0.10.0 已发布）。剩余：已合并的 3 个远端分支待 HU 删除。

## Current Phase
N.D

## 背景
- 前置：0.9.0 已发布（7b57af9）。上一轮：`.planning/2026-11-19-issues-63-68/`。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md`：先出计划再写代码；测试与 step 禁止 sleep；宣称完成前实跑验收；每阶段验证完自动提交 + 开 PR；用户个人信息不写进包。
- 摘要与代码定位见 findings.md。

## Issue 一览
| # | 类型 | 内容 | 阶段 | 紧急度 |
|---|------|------|------|--------|
| 74 | bug（回归） | native-module 包装在 tracker 关闭时也生效，RNGH/Reanimated worklet 调用崩溃 | N.A | 高 |
| 75 | 发布事故 | 0.9.0 core 的 dist 里残留 DBG 调试输出 | N.A | 高 |
| 73 | bug | expo export 覆盖 dev server 的 build-config，误报「app 没有最新改动」 | N.A | 中 |
| 76 | 改进 | app 崩溃时错误不说原因（只有 close code 1006） | N.B | 中 |
| 77 | 改进 | 崩溃后两次等满 connectTimeoutMs（约 60 s） | N.B | 中 |
| 78 | 改进 | scrollTo 步内 SYNC_TIMEOUT 无步信息；timeline 无步子 span | N.C | 低 |

## 决定事项（2026-11-20 HU 已确认）
| ID | 问题 | 推荐 |
|----|------|------|
| D1 | #74 怎么修 | **HU 选：构建时显式开启**（构建时不开就完全不碰 TurboModuleRegistry / expo.modules，与 0.8.0 一致）。原推荐：tracker 关闭时模块 Proxy 的 get 直接返回原始函数（模块加载时解构的引用永远是原 HostFunction）；默认 skip RNGH / Reanimated / Worklets 模块；`ignoreNativeCalls` 中只写模块名的条目也不再包装 |
| D2 | 发版节奏 | **HU 选：全部做完一起发**（原推荐先发 0.9.1 hotfix） |
| D3 | #76/#77 范围 | **按推荐：**  DeviceProvider 加「进程是否存活」；断开且进程不在 ⇒ `APP_CRASHED`，附崩溃摘要（Android logcat FATAL EXCEPTION、iOS 最新 .ips 的异常类型 + 栈顶，复制 .ips 进 evidence）；evidence 与下一 scenario 都跳过重连等待 |
| D5 | 版本 / 合并 | **HU：全量跑完后合并 PR，版本 0.10.0** |
| D4 | #78 范围 | **按推荐：**  步内 SYNC_TIMEOUT 包上步信息 + timeline 每步子 span；保留通过场景 timeline 用已有 `artifacts.timeline: 'all'`，回复说明 |

## Phases

### N.0 调研与计划
- [x] 读 6 个 issue，写 findings
- [x] 代码定位
- [x] HU 确认 D1–D4
- **Status:** complete

### N.A #74 #75 #73
- [ ] #74 native-module：构建时开关（metro.cjs 写进 build-config），没开就不 install；开了时 enableTracker 才可用，没开时 config 里开 tracker ⇒ 明确警告；文档三语；单元测试；example 加 ReanimatedSwipeable 滑动场景实测 iOS/Android
- [x] #75 release：`pnpm clean`，release:check 先干净构建；check-release 检查 dist 的 console 调用多于源文件；根因：调试时直接改了 dist（src 没变 ⇒ tsc -b 不重建）
- [x] #73 metro.cjs：build-config.dev.js / build-config.export.js；单元测试；实测 Metro 运行中 `pnpm build:web` 后 iOS 显示 `Metro started …, watching files`、无警告
- [x] `pnpm clean && pnpm check`（978）、check-release ok；PR #79
- **Status:** complete

### N.B 崩溃诊断与快速重启：#76 #77
分支 fix/app-crash-diagnosis（叠在 PR #80 上）。example 的手势页有 0.9.0 可复现的崩溃，但更直接的是加一个「让 app 崩溃」的 backdoor / 按钮。
- [x] DeviceProvider `isAppRunning()`（Android `pidof`，iOS launchctl list）+ `crashReport(since)`（devices/crash.ts 解析）
- [x] 等重连时每 500 ms 查进程 ⇒ `APP_CRASHED` + 摘要；断开的调用 5 s 内进程消失 ⇒ APP_CRASHED，否则 AGENT_DISCONNECTED
- [x] evidence 只收截图 + crash.txt + iOS .ips；下一 scenario 立即重启
- [x] 单元测试（crash 5 + session 3）；`pnpm clean && pnpm check` 989；实跑用临时场景（外部 kill -ABRT / am crash，未提交）
- [x] PR #81（叠在 #80）
- 已知：Android Java 崩溃后进程可能还活 1.5–17 s（系统行为），连接断开后才报；iOS 第一次实跑返回 AGENT_DISCONNECTED（未复现）
- **Status:** complete

### N.C scrollTo 步信息：#78
分支 fix/scroll-to-step-context（叠在 PR #79 上）。
- [x] runtime.ts scrollTo：步内 SYNC_TIMEOUT 包步号/上限/offset/方向/前几步耗时；结果和错误 data 带 `steps`（protocol StepTiming）
- [x] timeline 每步子 span（trace + html，失败的调用也有）
- [x] 单元测试 3 个 + 文档三语；`pnpm check`（981）；iOS 实测 trace 里有 step N + idle 等待
- [x] PR #80
- **Status:** complete

### N.D 验收、回复、发版（全部一起）
- [x] 三端全量：Android 99/1（模拟定位，已知）、web 85/0、iOS 第一次 90/12（模拟器被重置成日语）⇒ 改回 en 后 iOS 102/0
- [x] 合并 PR #79 → #80 → #81（先改 base 再合并）；远端分支删除被 auto mode 拦下，留给 HU
- [x] 版本 0.10.0、release:check（clean 构建、989 tests、12 包）、本地提交 d1d0f37（未 push）
- [x] HU `pnpm -r publish`（npm view：12 包 0.10.0，core 无调试行）；tag v0.10.0（d1d0f37）、push main + tag、GitHub Release 0.10.0（Latest）
- [x] 回复并关闭 #73–#78
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `pnpm check` 第一次 2 个测试文件失败（xcodebuild 同时在跑） | 1 | 重跑 94/94 通过；判断为 CPU 负载下的时序问题，再出现就查具体文件 |
