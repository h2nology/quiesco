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

## 2026-11-19 Session 1（L.B）
- PR #56（L.A）已开。L.B 分支 `fix/scroll-tap-clipping`。
- 调研 #46：方向（根因）和惯性（iOS 速度阈值）；停顿松手无效，ease-out 有效。
- 实现 #45 三处 + #46 两处。第一次三端跑：iOS / Android scrollTo 第 120 行超时（650 ms 每步太慢）⇒ 每步 0.85 视口 + scrollTo 的一步 400 ms；web 失败 ⇒ 发现 RNW 的 refresh 包装层（L.A 的 web 验证用了旧 dist）⇒ 改成结构判断。
- 最终：actions.feature 三端 8/8，`pnpm check` 917 通过。未提交，等 HU 确认。

## 2026-11-19 Session 1（L.C）
- PR #57（L.B）已开。L.C 分支 `feat/device-input-l-c`。HU 把 D4 改为固定间隔 + 最后等 idle。
- 实现 #48 / #53 / #52。第一次三端跑：web「一次输入」7 次按键（web 本来逐键）⇒ 场景改 @native；Android「逐字输入」丢第一个字 ⇒ 实验（聚焦后等 500 ms 通过）⇒ 改为 settle（waitForIdle），去掉 settle 3 次里 2 次失败、加上 3/3 通过。Android「模拟定位」失败是环境问题（改动前同样失败）。
- 最终：三端实跑见 task_plan.md；`pnpm check` 928 通过。未提交，等 HU 确认。

## 2026-11-19 Session 1（L.D）
- PR #58（L.C）已开。L.D 分支 `feat/app-dir`。
- 实现 appDir（core / doctor / build / upgrade / dev-server / session）。新测试第一次 2 个失败：Android 设备检查依赖本机（断言里排除）、npm install 参数写错了期望（行为正确）。
- 实跑：独立测试包里 doctor 通过，iOS / web 测试通过，Metro 在 app 目录启动。实跑时发现 app 路径离得远时显示一长串 ../ ⇒ 改成显示绝对路径。
- `pnpm check` 938 通过。未提交，等 HU 确认。
