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

## 2026-11-16 会话 1（续）：K.B
- K.A 提交并开了 PR #36。提交信息的 subject 后少了空行；想改写后 force-push，被 auto mode 拒绝 ⇒ 保持原样，squash 合并时可以修。
- 分支 `fix/init-doctor-upgrade`，叠在 `fix/error-diagnostics` 上（计划文件只在那里）。
- HU 决定：upgrade 直接改并列出（另有 --dry-run）；五项都修；还要能升级包的版本（`npx quiesco@latest init --upgrade`）。实施计划写进 task_plan.md。
- K.B 代码：setup-steps.ts（init 的几步抽出来）、upgrade.ts（`init --upgrade`，含版本升级）、init 写回 app.json 的 ID、doctor 新检查（cucumber paths / tsconfig / build scripts info / app IDs）、android 启动失败的诊断。`pnpm check` exit 0（862 个测试）。文档三语 + plugin references。
- 实测（scratchpad/kb，本分支打包的 tarball）：
  - A：create-expo-app blank-typescript（app.json 没有 ID，和 issue 一样）→ init ⇒ app.json 写入 com.anonymous.qtnew / scheme qt-new，config 里没有占位符 → doctor 通过（app IDs ✅）→ e2e:build:android BUILD SUCCESSFUL → e2e:android 1 scenario passed。
  - B：同一模板 + 已发布的 `quiesco@0.1.1 init`，装 0.1.1 的包 ⇒ 0.1.1 的 doctor 通过（重现 #35）；本分支 doctor 报 cucumber paths ⚠️、<QuiescoRoot> ❌、app IDs 占位符 ❌、build scripts ℹ️。`init --upgrade --dry-run` 没有改动任何文件（git status 为空）；`init --upgrade --packages` ⇒ 6 个包升到 0.4.0、删 paths、tsconfig、app.json ID、替换占位符、补脚本、包上 QuiescoRoot；再执行一次全部是 `=`、git status 为空；doctor 通过。B 的 Android 构建和 e2e：跑着。
- B：e2e:build:android → e2e:android 1 scenario passed。
- am start 诊断（A，临时改 config）：package 写成 com.example.app ⇒「is installed but does not open qt-new:// links」（模拟器上确实有以前测试留下的 com.example.app）；写成不存在的 com.anonymous.nothere ⇒「is not installed on emulator-5554 … npx quiesco doctor compares them」。config 已还原。
- K.B 实测完成。下一步：等 HU 确认提交 / PR。
- HU 确认后提交并开 PR（base fix/error-diagnostics）。K.B 完成，下一步 K.C。HU 要求以后用中文交流（已记入 memory）。

## 2026-11-16 会话 1（续）：K.C
- PR #37（K.B，base fix/error-diagnostics）。分支 `fix/logbox` 叠在上面。
- 调研：RN 0.88 LogBox、Expo `@expo/log-box` 只换 UI（见 findings）。
- 实现：protocol `LogBoxMode`、config `appErrors.logBox`（默认 clear）；agent `reset/logbox(.native).ts`，configure 时 ignore、软重置前 clear；Driver 收集场景内的 console.error，失败消息加一行 + `data.appLogErrors`，失败场景附 `app-errors.txt`。`pnpm check` exit 0（868 个测试）。文档三语。
- 实测：项目 A 换成本分支的包（`init --upgrade --packages ../tgz2`），App 加 log-error / bottom 按钮，features/logbox.feature；Android 上 clear 与 keep 对照：跑着。
- 实测：clear ⇒ 1 passed / 1 failed（失败消息带 console.error，后一个场景通过）；keep ⇒ 2 failed（后一个场景的点击被 LogBox 吃掉）。两个新发现记进 findings，等 HU 决定。
- HU：第 2 点（LogBox 帧折叠）本阶段做，第 1 点开新 issue。实现 `collapseAgentFrames`（metro.cjs），测试 1 个；真机 keep 模式截图确认 Source = App.tsx:10:87。`pnpm check` exit 0（869 个测试）。新 issue #38。提交并开 PR。K.C 完成，下一步 K.D。

## 2026-11-16 会话 1（续）：K.D
- PR #39（K.C）。分支 `fix/expo-ui-datepicker`。
- 项目 A 装 @expo/ui 58.0.28，重建 Android / iOS，诊断 feature 打印 query 和 setValue 错误：iOS 370×0 / 0×0，Android inline 0×0（Host 宽 0），Android dialog 没有 testID（Host 高 0）。完全复现 #29。详见 findings。
- 写出实施计划，等 HU 确认。
- HU 确认 K.D 方案（最近的有面积祖先；INSIDE_DEPTH 8）。实现 + 测试，`pnpm check` exit 0（875 个测试）。文档三语。实测：四种情况的 setValue 修前全部失败、修后全部成功（见 task_plan）。提交并开 PR。K.D 完成。

## 2026-11-16 会话 1（续）：K.E
- HU：按顺序合并并发布。#36 合并时删 base 分支导致 #37 被关闭，已恢复（见 Errors）；#37、#39、#40 依次合并（ac19e2e），分支已删。
- main 上三端全量 e2e：web 79/13、iOS 86/6、Android 86/6，0 失败。main ci success。
- 版本 0.4.1，release:check 通过，`chore(release): 0.4.1` 推送。发布说明、issue 回复的草稿在 scratchpad。下一步：HU 执行 publish。
