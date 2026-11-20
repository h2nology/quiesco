# Progress: issues #63–#68

## 2026-11-19 Session 1
- `init-session.sh "issues 63-68"` ⇒ `.planning/2026-11-19-issues-63-68/`（已设为 active plan）。
- `gh issue list`：open 的是 #63–#68 共 6 个。逐个读完正文。
- 代码定位：runtime.ts scrollTo / multiStep、driver.ts MAX_SCROLL_STEPS、ios.ts openNotification、ios-runner.ts call/start、SystemUIServer.swift screen()、wait-for-idle.ts、sync.mdx tracker 表。写入 findings.md。
- 写了 task_plan.md（阶段 M.0–M.E，待决定 D1–D6）。等 HU 确认。
- HU 确认：D1、D2、D4、D5、D6 均选推荐项（D2 不退回长横幅等待）。进入 M.A。
- M.A：分支 `fix/scroll-to-steps`。runtime.ts / driver.ts / 三语 api.mdx / plugin refs / 3 个单元测试 / example 新场景。`pnpm check` 通过（951）。
- 实测：Metro（`pnpm start:e2e`，后台）+ iOS 27 模拟器 + Android emulator-5554。长列表场景 iOS 3/3、Android 3/3；旧 runtime 下新场景 iOS 失败（SYNC_TIMEOUT）；web actions.feature 10 passed / 1 skipped（@native）。
- 单元测试第一次失败：预期 20 步，实为 19 步（行中心在 offset 6460 时已可见）⇒ 改断言。
- M.A 提交 + PR #69（base main）。M.B 分支 `fix/ios-open-notification` 从 fix/scroll-to-steps 开（堆叠）。
- M.B 实现：prepareSystemUi、Swift snapshot `/screen` + `/appState`、isRunnerGone 重试策略、openNotification 以前台判断点中 + 堆叠取最上面 + 锁屏 Open、D3。单元测试 core 318 全过。
- iOS 实测：新场景第一次失败（锁屏 Open）→ 修复 → 通知两个场景 6/6。探针脚本确认 snapshot `/screen` 在 app 前台时 others 为空、appState=4。
- 注意：报告里出现「app JS: bundle built 23:37:50, a one-off export」警告（`pnpm build:web` 之后），iOS 的 app 实际用的是 Metro（新按钮存在、能点到），待查这个警告是否误报。
- 跑 iOS 全量（后台）。
- iOS 全量第 1 次 96/107（4 failed），原因是锁屏 Open 判断太宽 ⇒ 收紧 + 堆叠展开立即重找。之后通知场景 6/6、system.feature 2×15/15（真机走到锁屏 Open 路径）、Android system.feature 12 passed。`pnpm check` 960 通过。M.B 提交、开 PR。
- M.B 提交 + PR #70（base fix/scroll-to-steps）。
- M.C：分支 fix/background-idle-wait。复现 16 次未出现挂住（debug 0 行）。实现 host tick + engine.wake。单元测试、三语文档、requirements §7。定位权限场景 10/10，`pnpm check` 965。Android 全量（后台）进行中。
- M.C 回归：Android 全量 97/108（2 failed：#63 场景超时太紧 ⇒ 3000 ms；模拟定位 = AOSP 无 GMS 环境问题）；滚动两端 3/3；iOS device.feature 17/17。M.C 提交 + PR。
- M.C 提交 + PR #71（base fix/ios-open-notification）。
- M.D：分支 feat/native-module-tracker。实现 native-module tracker + 配置 + 三语文档 + 单元测试。真机：阈值 60 s 时 Android SYNC_TIMEOUT 列出 ExpoLocation.requestForegroundPermissionsAsync（包装生效、#66 tick 生效）；阈值 2 s 两端通过。tracker 打开的 Android 全量（后台）进行中。临时改了 examples/todo-app/quiesco.config.mts（NM_THRESHOLD），备份在 scratchpad，提交前还原。
- M.D 全量（tracker 开）：Android 98/108（模拟定位 已知）、iOS 101/108 + 7 skipped 无失败。还原 config，pnpm check 973。提交 + PR。
- M.E：web 全量发现定位权限场景缺 @native ⇒ 补上（1dbf564，PR #72）。三端全量都已跑过。等 HU：合并 / 回复 issue / 发版。
