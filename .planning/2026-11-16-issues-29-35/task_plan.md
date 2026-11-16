# Task Plan: 处理 GitHub issues #29–#35（0.4.0 之后）

## Goal
解决 h2nology/quiesco 的 7 个 open issue（同一位用户在 0.4.0 + Expo SDK 58 + @expo/ui 上实测的反馈）。每个修复都配测试和三语文档，实跑验收后回复并关闭 issue，最后一起发下一个版本。

## Current Phase
K.B init / doctor

## Next Step
K.B：先给出实施计划（init --upgrade 的范围、app.json 写回的细节），然后从 #35 的 doctor 检查做起。

## 背景
- 前置：0.4.0 已发布（`.planning/2026-11-15-issues-17-23/`）。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md` 的「工作约定」：先出计划再写代码；测试和 step 里禁止 sleep；宣称完成前要实跑验收；待确认事项问 HU；用户的个人信息不写进包，也不发给外部服务。
- issue 摘要和代码定位见 findings.md。

## Issue 一览与分组

| # | 类型 | 标题（简） | 阶段 | 难度 |
|---|------|-----------|------|------|
| 32 | enh | 驱动报错的堆栈全是 ws/core 内部帧 | K.A | 小 |
| 33 | enh | 元素摘要 text 没有分隔符 | K.A | 小 |
| 30 | enh | setValue 找不到控件时没说找过哪些组件 | K.A | 小–中 |
| 35 | enh | doctor 查不出旧版 init 生成的问题 | K.B | 小 |
| 34 | bug | init 写入 ID 占位符，doctor 通过，Android 失败 | K.B | 中 |
| 31 | enh | LogBox 没被报告，还导致之后的场景连锁失败 | K.C | 中 |
| 29 | bug | setValue 驱动不了 @expo/ui 的 DateTimePicker | K.D | 大（要真机调研） |

分组依据：K.A 是纯诊断输出（agent / core，不改行为），K.B 是 CLI 的 init / doctor（都改 `init.ts` / `doctor.ts`，放在一起做），K.C 是 app 错误和重置（agent events + reset + core driver），K.D 要先装 @expo/ui 在 iOS / Android 上调研。#30 的「列出找过哪些组件」会先做，正好拿来调研 #29。

## 待决定事项（2026-11-16：D1、D2 选了推荐项；D3 选了「doctor 检查 + init --upgrade」；D6 选了 0.4.1；D4、D5 按推荐默认执行）
| ID | 问题 | 推荐 |
|----|------|------|
| D1 | #31 怎么处理 console.error | 场景里发生的 console.error 不让场景失败，但附到失败消息里（列出最近 1 条，其余放进附件）；软重置时 `LogBox.clearAllLogs()`。e2e 构建默认**不** `ignoreAllLogs`（保留 app 原来的样子），在配置里加 `appErrors.logBox: 'clear' \| 'ignore' \| 'keep'`，默认 `'clear'`。 |
| D2 | #34 init 遇到 app.json 没有 ID 时 | 写回 app.json：`ios.bundleIdentifier` 和 `android.package` 都用 `com.anonymous.<slug 去掉非字母数字>`，`scheme` 用 slug；config 里用同样的值；init 输出里明说改了 app.json。doctor：config 跟 app.json 不一致 ⇒ fail，还留着 `TODO: expo.*` 占位符 ⇒ fail；只有构建产物存在时才跟它比（不一致 ⇒ fail）。Android `am start` 失败时补查 `pm list packages`，给出原因。 |
| D3 | #35 用 doctor 检查还是做 `init --upgrade` | 只加 doctor 检查（每项附修法）：cucumber.mjs 设了 `paths` ⇒ warn；tsconfig 缺 `allowImportingTsExtensions` 且 features/ 里 import 了 `.ts` ⇒ fail；缺 `e2e:build:*` 脚本 ⇒ info（不算 warn）。**HU 的选择：另外做 `init --upgrade`**（只修 doctor 认得的项，改之前先列出来，重复执行结果不变）。 |
| D4 | #33 用什么分隔符 | 空格。只改显示用的文本（摘要、错误消息、elements.json 的 `text`），`text` 匹配仍用拼接后的文本，行为不变。注意 elements.json / `query()` 返回的 `text` 字段会变 ⇒ 写进 CHANGELOG。 |
| D5 | #29 的支持范围 | 先在真机上调研（K.D.1），再定方案。初步：iOS 上 0 尺寸元素回退到最近的、有尺寸的 @expo/ui `Host` 祖先来测量和判断可见性（只认 Host，不做一般化的回退）；Android dialog 模式下按组件自己的 `testID` prop 找，0 面积的 Host 当作「不渲染视图」，跳过可见性检查（和社区版一样）。做不到的部分在文档里写明，并给出包一层 View 的绕法。 |
| D6 | 版本号 | 推荐 0.5.0（D1 加了新配置）。**HU 的选择：0.4.1**；所有阶段完成、三端验收后一起发。 |

## Phases

### K.0 调研与计划
- [x] 读 7 个 issue，写 findings
- [x] 代码定位（value.ts / visibility / events / reset / ws-server / traverse / init / doctor / android）
- [x] HU 确认 D1–D6
- **Status:** complete

### K.A 诊断输出（#32、#33、#30）
分支 `fix/error-diagnostics`（`fix/diagnostics` 这个名字已经被 J.C 用过）。
- [x] #32 `Driver.request` 开头（第一个 await 之前）用 `captureCallSite()` 记下调用方的堆栈，出错时用 `withCallSite()` 换掉（`core/src/errors.ts`）；要过滤的帧：core 自己的目录（src 或 dist）、`ws/`、`node:`/`internal/`。agent 的 RPC 错误、断线、app error、调用前就积压的 app error 都覆盖到；`checkAppRunning` 抛出的错误本来就是同步创建的，不处理。测试：driver.test 2 个（RPC 错误、断线），新文件 errors.test 2 个（模拟 issue 里 pnpm 安装路径下的帧）
- [x] #33 `HostNode.displayText`：`collect` 改为传一个累加器；`HostPlatform.inlineText`（native 用 `RCTVirtualText`，web 用 `span`）决定是不是同一段文本的一部分；`summarize` 和 hit-test 的元素描述改用它；`node.text` 和 matcher 不变。测试：native、web 各 1 个
- [x] #30 `findProps` 的 test 回调多了 `name` 和 `depth` 两个参数，`PropsRef` 多了 `depth`；`detectControl` 失败时附上 `searchReport`：往上 12 层（有名字或有控件 props 的组件），往里列出所有像控件的组件（往上找 12 层）和没被采用的原因（离元素超过 4 层 / 里面有多个控件）。测试 2 个（重现 issue 的结构：DateTimePicker 在 6 层之上；两个控件 / 空容器）
- [x] 文档三语 api.mdx：setValue 的错误、元素摘要的 text、错误的堆栈；重新生成 plugin references
- [x] `pnpm check` exit 0（848 个测试）；`docs:check --no-mint` 通过
- [x] web 全量 e2e：92 scenarios（79 passed, 13 skipped），0 失败（和 0.4.0 时一样）
- [x] HU 确认提交 / PR
- **Status:** complete

### K.B init / doctor（#35、#34）
- [ ] #35 doctor 加「cucumber.mjs paths」「tsconfig allowImportingTsExtensions」「e2e build scripts」三项检查；测试
- [ ] #35 `init --upgrade`：只修 doctor 认得的旧版问题（删掉 cucumber.mjs 的 paths、tsconfig 加上 allowImportingTsExtensions、补上缺的 e2e 脚本），改之前列出要改的内容，已经是新的就不动（幂等）；doctor 的修法里提示可以用它；测试（每一项、幂等、不认识的文件格式就跳过并说明原因）
- [ ] #34 init：app.json 没有 ID 时写回（按 D2），config 里用同样的值；有 app.config.* 时不能改 ⇒ 输出下一步要做什么
- [ ] #34 doctor：config 和 app.json 的 ID / scheme 是否一致，有没有 TODO 占位符；构建产物存在时比对 applicationId / CFBundleIdentifier / URL scheme
- [ ] #34 `android.ts` 的 `am start` 失败时，查包有没有安装，并给出原因和修法
- [ ] 实测：新建空白模板项目，init → doctor → build android → e2e:android 一路通过
- [ ] 文档三语：cli.mdx（init 步骤、doctor 检查项）、troubleshooting
- **Status:** pending

### K.C app 错误与 LogBox（#31）
- [ ] 调研：RN 0.88 的 LogBox API，console.error 在 dev-client 里怎么触发 LogBox，agent 能不能拿到 LogBox
- [ ] agent：转发 console.error 时带上标记（时间、场景），core 按场景收集；失败时把最近一条写进消息，全部放进附件
- [ ] reset：软重置时按配置 `clear` / `ignore` / `keep` 处理 LogBox（默认 clear）
- [ ] 配置类型 + 文档三语（config、debugging / 首次运行失败的「LogBox 盖住 app」）
- [ ] 实测：example 里加一个会 console.error 的场景 ⇒ 消息里能看到这条错误，后面的场景不受影响（iOS / Android）
- **Status:** pending

### K.D @expo/ui DateTimePicker（#29）
- [ ] K.D.1 调研：在 example 里装 @expo/ui，iOS spinner / inline 和 Android dialog / inline，用 `quiesco tree` 和 K.A 新的诊断看 fiber / host 结构，结果写进 findings
- [ ] K.D.2 按 D5 实现（visibility 回退到 Host；Android dialog 按组件 testID 找）；单元测试
- [ ] K.D.3 example 加 @expo/ui 的日期场景，三端通过（web 上它渲染 null ⇒ 跳过或用别的方式）
- [ ] 文档三语：value controls 表里加 @expo/ui DateTimePicker（支持状态、限制）
- **Status:** pending

### K.E 发布
- [ ] CHANGELOG（#33 的 text 字段变化写明）
- [ ] 三端全量 e2e 验收（caffeinate）
- [ ] 版本号改为 0.4.1，发布
- [ ] 逐个回复并关闭 #29–#35
- **Status:** pending

## Decisions Made
| 日期 | 决定 | 依据 |
|------|------|------|
| 2026-11-16 | D1 console.error 附到失败里，软重置时清掉 LogBox（`appErrors.logBox` 默认 clear） | HU 选了推荐项 |
| 2026-11-16 | D2 init 把 ID 写回 app.json | HU 选了推荐项 |
| 2026-11-16 | D3 doctor 检查 + `init --upgrade` | HU 选的 |
| 2026-11-16 | D6 版本号 0.4.1（虽然有新配置项，仍按补丁版本发） | HU 选的 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| 想用 AGENT_TIMEOUT 测 #32，但 host 有 5s 余量（HOST_MARGIN_MS），测试超时 | 1 | 改为让 agent 断线（AGENT_DISCONNECTED） |
| `git checkout .planning/.active_plan` 把 init-session 改好的指针还原了 | 1 | 用 set-active-plan.sh 重新指向本计划 |
| lint：解构剩余参数里的 `_depth` 没用到 | 1 | 改为显式构造 Control |
