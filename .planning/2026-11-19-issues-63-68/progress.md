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
