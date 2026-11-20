# Task Plan: 处理 GitHub issues #82–#87（0.10.0 之后）

## Goal
解决 h2nology/quiesco 的 6 个 open issue（0.10.0 上的实测反馈，主要是 iOS 系统 UI）。每个修复配单元测试、必要时更新三语文档；实跑验收后回复并关闭 issue，然后发版。

## Next Step
全部完成（0.11.0 已发布；main a201e0e 的 ci / prod-strip / sdk-compat 全部通过；已合并分支和 4 个旧本地分支已删除，只剩 main）。

## Current Phase
完成

## 背景
- 前置：0.10.0 已发布（d1d0f37）。上一轮：`.planning/2026-11-20-issues-73-78/`。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md`：先出计划再写代码；测试与 step 禁止 sleep；宣称完成前实跑验收；每阶段验证完自动提交 + 开 PR；用户个人信息不写进包。
- 摘要与代码定位见 findings.md。

## Issue 一览
| # | 类型 | 内容 | 阶段 | 紧急度 |
|---|------|------|------|--------|
| 87 | bug | iOS system.tap/tapAt/expectVisible 在系统 UI 动画中就点，点击丢失却报成功 | N.A | 高 |
| 82 | bug | iOS 27 Notification Center 路径：点通知只露出 "Open"，3 s 后才找它，已收回 | N.A | 高 |
| 86 | 改进 | 清理残留通知权限弹窗时点 "Don't Allow"，留下持久的 denied | N.B | 中 |
| 85 | 改进 | openNotification / system.* 超时消息不列系统 alert（"seen: nothing"） | N.B | 中 |
| 83 | bug | doctor scripts 检查把 `E2E_TOOL=quiesco quiesco build` 读成 `quiesco quiesco` | N.C | 低 |
| 84 | 改进 | 测试 runner 自己超时时，scrollTo 的步子在 timeline 里丢失 | N.C | 中 |

## 决定事项（2026-11-20 HU 已确认：全部按推荐）
| ID | 问题 | 推荐 |
|----|------|------|
| D1 | #87 怎么等系统 UI 稳定 | 抽出 openNotification 已有的「两次读取 frame 一致才点」做成共用函数；system.tap / type / expectVisible 的 iOS 路径都用（tapAt 无节点，改为点之前等屏幕 alerts+others 两次一致）。Android 不变（uiautomator dump ~2 s，自然稳定） |
| D2 | #82 怎么修 | tapOpened 等待期间每次轮询都找 revealed "Open"，一出现（两次一致）立刻点；runner 在 sendToBackground() 时预热（后台启动，不阻塞）；警告文字改成「Notification Center / Cover Sheet」 |
| D3 | #86 残留权限弹窗 | **不再点 Don't Allow**：权限弹窗（synthetic id 那种）不自动关，下一个 scenario 开始时报清楚的错误（"上一个 scenario 留下的通知权限弹窗还开着；在测试里 system.allowPermission() / denyPermission()"）；非权限 alert 仍按 cancel 关，并 log 点了哪个按钮。另一选择：改点 Allow（会让测试意外获得权限，不推荐） |
| D4 | #84 范围 | agent 新增 `step` 事件（每步完成即发给 host）；host 的 Timeline 记录进行中的调用，写 timeline 时（scenario 结束 / 测试超时 teardown）把未结束的调用连同已收到的步子写成 `error: 'still running when the scenario ended'`。不做「测试超时短于可能耗时」的警告（runner 超时拿不到） |
| D5 | 版本 / 合并 | 全部做完一起发 0.11.0（protocol 加事件 ⇒ minor）；全量跑完后合并 PR |

## Phases

### N.0 调研与计划
- [x] 读 6 个 issue，写 findings
- [x] 代码定位
- [x] HU 确认 D1–D5（全部按推荐）
- **Status:** complete

### N.A iOS 系统 UI 时序：#87 #82
分支 fix/ios-system-ui-timing。
- [x] provider `systemUiSettleMs` + `systemNodeReread`：iOS 只重读 SpringBoard（App 元素树节点不重读，读一次可达 18.5 s）；system.tap / type / expectVisible / 权限对话框两次一致才动；tapAt 等 SpringBoard 静止（≤2 s）
- [x] tapOpened 轮询时找 revealed "Open"，两次一致立刻点；sendToBackground 预热 runner（共享启动 promise）；警告文案
- [x] 单元测试；三语文档；`pnpm check` 993
- [x] iOS system.feature ×3：14/4/1，通知场景 3/3 通过；唯一失败（中文打字，接在 ASCII 后）main 上同样失败 ⇒ 已有问题，N.D 再看
- [x] PR #88
- **Status:** complete

### N.B iOS 系统 alert：#86 #85
分支 fix/ios-system-alerts（叠在 #88）。
- [x] 权限弹窗不再自动回答：dismissButton 对权限弹窗返回 undefined；dismissLeftoverAlerts 抛 RESET_FAILED（弹窗标题 + 按钮）；其他 alert 仍关，日志写按钮
- [x] 元素被遮住且有不回答的权限弹窗 ⇒ 错误后附说明（provider unansweredSystemAlert）
- [x] openNotification 超时列出 alerts + 提示
- [x] 文档三语 + plugin refs；`pnpm check` 996
- [x] iOS 实测：临时场景验证 #85/#86 消息；system+permissions 回归（2 个失败：已有的中文打字 + 我 kill 进程留下的 Face ID 录入状态，重置后通过）
- [x] PR #89
- **Status:** complete

### N.C CLI 与 timeline：#83 #84
分支 fix/cli-scripts-and-step-timeline（基于 main）。
- [x] scriptCommands 边界字符加 `=`；单元测试
- [x] protocol `step` 事件（StepTiming 挪到 timing.ts 避免循环依赖）；agent recordStep 发送；Timeline 记录进行中调用、写出时标 STILL_RUNNING；reset 后迟到的结果不进下一个 scenario；scrollTo 标签带 target
- [x] 单元测试 + 文档三语；`pnpm check` 991
- [x] iOS 实测：临时 vitest 测试 3 s 超时 ⇒ trace 有 scrollTo（still running）+ step 1–4
- [x] PR #90
- **Status:** complete

### N.E 已有问题：iOS 中文打字场景失败（HU 2026-11-20 要求一起修）
「用系统输入在 App 的对话框里打字（中文）」接在 ASCII 例子后失败（main 同样）。
- [x] 产物分析：element-tree 里所有 rect 偏了约 (+315, +712)（login-screen 在 (315,712)，屏幕 402×874），截图正常 ⇒ agent 坐标校准（calibrateCoordinates）量到了错误的值，不是滚动问题
- [x] 上设备复现：locate(8)（App 根 view）返回 UITextEffectsWindow 里一个隐藏的 0.33×41 RCTViewComponentView（键盘用过后才出现，窗口层级高于 App）⇒ offset (314.67, 712)，持续到 App 结束（values.feature 7 个连锁失败）
- [x] 原生修复：QSTouchInjector viewWithReactTag 收集所有同 tag 组件 view，跳过 UITextEffectsWindow / UIRemoteKeyboardWindow，优先可见且非零尺寸（原 viewWithTag: 每窗口只返回第一个匹配）
- [x] JS 防线：locate 返回的宽高与 RN rect 差 >1 ⇒ 跳过该候选（旧 @quiesco/native 也有效；Android 单位同为 dp）+ 单元测试
- [x] 实测（仅 JS 防线，旧原生）：system:144+145 + values.feature ×3 全过（13 passed / 1 skipped）
- [x] 重建 iOS App；只靠原生修复（临时关 JS 防线）system:144+145+values 13/1 通过
- [x] Android 全量 4 个滚动失败 = 与 iOS 构建同时跑的负载问题（单独跑 / actions.feature 11/11，开关尺寸检查都通过）
- [x] 分支 fix/ios-tag-lookup-keyboard-window，`pnpm check` 990，PR #91（基于 main）
- **Status:** complete

### N.D 验收、回复、发版
- [x] 三端全量（集成分支 #88–#91）：web 85/24/0；Android 99/9/1（定位，已知）；iOS 重跑 102/7/0
- [x] 合并 #88 → #89（先改 base）→ #90 → #91；main a201e0e 与集成分支内容一致
- [x] 版本 0.11.0、release:check（clean、999 tests、12 包）、本地提交 0dbc1ef（未 push）
- [x] main 的 ci / sdk-compat / prod-strip（android、web、ios）全部通过
- [x] HU `pnpm -r publish`（第一次没发出去，registry 无 0.11.0；第二次 12 包 latest=0.11.0；tarball 无 TEMP 调试输出）；tag v0.11.0（0dbc1ef）、push main + tag、GitHub Release 0.11.0（Latest，含 #91）
- [x] 回复并关闭 #82–#87；open issue 0
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| settle 全量重读 ⇒ 网页登录 60 s 超时 | 1 | 只重读 SpringBoard（systemNodeReread） |
| 预热 runner 在单元测试里真的跑 xcodebuild -version | 1 | 测试注入 fake runner |
| docs:check：plugin refs 过期 | 1 | build-plugin-refs.mjs，补到 #88 |
| 临时场景的权限弹窗卸载重装后仍在 | 1 | 用 allowPermission 的临时场景回答 |
| Face ID 录入被 kill 的运行留成「已录入」 | 1 | notifyutil -s …enrollmentChanged 0 |
| depcruise：events.ts → methods.ts 循环 | 1 | StepTiming 挪到 timing.ts |
| vitest 临时测试 3 s 超时含 App 启动 | 1 | 先跑一个启动测试 |
| 三端全量并行：Android / web EADDRINUSE 3001 / 7357 | 1 | 全量按平台依次跑 |
| Android 全量与 iOS 构建并行 ⇒ 4 个滚动场景超时 | 1 | 不在全量时构建；单独重跑通过 |
| 全量2 iOS：通知场景（runner 热）1/4 失败：2 s 就开通知中心，3 s 后的通知落进通知中心，点了无反应 | 1 | BANNER_WAIT_MS 2 s → 5 s（e5e6658，#88）；74+83 ×12 全过 |
| 全量2 iOS：showcase:23 原生画面空白（RN 树在，native view 不在窗口，前一场景刚结束 WebView 进程） | 1 | 单独 ×3、按顺序 ×2 不复现；记为偶发（同 2026-11-07 findings「原生转场被丢」类） |
