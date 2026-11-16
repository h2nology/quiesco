# Progress: issues #29–#35

## 2026-11-16 会话 1
- 新建计划 `2026-11-16-issues-29-35`（用 `init-session.sh` 建的；`.active_plan` 指向它）。
- 读了 7 个 open issue（#29–#35），摘要写进 findings.md。
- 用 grep 定位了相关代码，写进 findings.md 的「代码调研」。
- 写了 task_plan.md：K.A–K.E 五个阶段，待决定事项 D1–D6。
- 下一步：等 HU 确认 D1–D6。
- HU 的回答：D1、D2 选推荐项；D3 选 doctor 检查 + init --upgrade（K.B 加了任务）；D6 选 0.4.1；D4、D5 按推荐默认执行。K.0 完成，下一步是 K.A。

## 2026-11-16 会话 1（续）：K.A
- 分支 `fix/error-diagnostics`。
- #32：core 的 `captureCallSite` / `withCallSite`，在 `Driver.request` 里用上。错误堆栈改为从调用方开始。
- #33：`displayText`（同一段文本里的部分不加空格，分开的文本加空格），用于摘要和 hit-test 的描述；matcher 不变。
- #30：setValue 失败时列出往上、往里找过的组件和没被采用的原因（重现 issue：DateTimePicker 在元素之上 6 层，超过限制 4 ⇒ 这很可能就是 #29/#30 的原因之一，K.D 要在真机上确认）。
- 文档三语 api.mdx；plugin references 重新生成。
- `pnpm check` exit 0（848 个测试）；docs:check 通过。
- web 全量 e2e：跑着。
- web 全量 e2e：92 scenarios（79 passed, 13 skipped），0 失败。下一步：等 HU 确认提交 / PR。
- HU 确认后提交并开 PR。K.A 完成，下一步是 K.B。
