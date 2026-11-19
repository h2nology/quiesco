# Progress: issues #44–#55

## 2026-11-19 Session 1
- 用 `planning-with-files` 新建 plan `2026-11-19-issues-44-55`（`.planning/.active_plan` 已指向它）。
- `gh issue list` 拉到 12 个 open issue（#44–#55），全部读完，摘要写进 findings.md。
- 初步 grep 定位每个 issue 涉及的代码，写进 findings.md。
- task_plan.md：分成 L.A–L.F 六个阶段，列出待决定事项 D1–D8。
- 状态：等 HU 确认 D1–D8。没有改任何代码。
- HU 确认：D1 三处都修、D2 app.openUrl 直接支持、D7 先调研、D8 全部完成后发 0.8.0；D3–D6 按推荐。进入 L.A。

## 2026-11-19 Session 1（L.A）
- 分支 `fix/issues-44-47-55`。#47、#55、#44 的代码、测试、三语文档都完成（细节见 task_plan.md L.A）。
- 实跑：#44 在 Android 上先复现（去掉修复 ⇒ 场景失败），修复后通过；actions.feature 三端各 5/5。#55 的 setupFiles 写法在 web 上实跑确认。
- `pnpm check` 第一次失败 1 个：init.test 断言旧的单行 vitest config ⇒ 改成匹配多行；plugin references 过期 ⇒ 重新生成。第二次 exit 0（910 个测试）。
- 未提交，等 HU 确认。
