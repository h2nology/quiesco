# Progress: GitHub issues #1–#9

## Session 2026-11-14
- 新建计划 `.planning/2026-11-14-issues-0-2/`（PLAN_ID=2026-11-14-issues-0-2；`.active_plan` 已切到此计划）。
- `gh issue list` 读取 9 个 open issue（#1–#9，全部 2026-11-14 创建），全文要点写入 findings.md。
- 分成 6 个阶段：I.A CLI 小修（#7 #8）→ I.B 重置（#1 #9）→ I.C 诊断（#2 #3）→ I.D API（#4 #6）→ I.E 工作流（#5）→ I.F 验收发布。
- 待 HU 确认 D1–D6 后开始 I.A。尚未改代码。
- HU 决定：D1=a（agent 自动重置 expo-router）、D3 两者都做、D5=0.2.0、D6 按阶段一个 PR。D2、D4 未答，进入 I.B 前再问。

### I.A（#7 #8）
- 分支 `fix/cli-help-and-cucumber-paths`。改：`packages/cli/src/commands/test.ts`（TEST_HELP、`--` 分割）、`cli.ts`（HELP 提示）、`init.ts`（CUCUMBER_CONFIG 去 paths）、`examples/todo-app/cucumber.mjs`、docs en/ja/zh `cli.mdx`；测试 +2 个 / init 断言 +2。
- 实测 dry-run：修前单文件 86 场景 + 弃用警告；修后 5 场景、0 警告；`-- --tags` 过滤正常。
- `pnpm check` exit 0（679 tests）。`docs:check` 第一次失败：ja/zh 行内代码比 en 多一个 `--` ⇒ 改写译文措辞后通过。
