# Task Plan: 处理 GitHub issues #29–#35（0.4.0 之后）

## Goal
解决 h2nology/quiesco 的 7 个 open issue（同一位用户在 0.4.0 + Expo SDK 58 + @expo/ui 上实测的反馈）。每个修复都配测试和三语文档，实跑验收后回复并关闭 issue，最后一起发下一个版本。

## Current Phase
K.C app 错误与 LogBox

## Next Step
K.C：先调研 RN 0.88 的 LogBox API 和 console.error 的转发路径，写出实施计划。

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
分支 `fix/init-doctor-upgrade`，叠在 `fix/error-diagnostics`（PR #36）上面：计划文件只在那个分支里。

2026-11-16 HU 对 `init --upgrade` 的决定：
- 直接改文件，并逐项列出改了什么；`--dry-run` 只列出不改。
- 修这些项：cucumber 配置里旧的 `paths` 行；tsconfig 的 `allowImportingTsExtensions`；app.json 的 ID 和 config 里的 TODO 占位符；缺的 `e2e:*` 脚本；`<QuiescoRoot>`。
- **另外要能升级版本**：用 0.1.0 init 过的项目，执行 `npx quiesco@latest init --upgrade` 就把所有 Quiesco 包装成这个 CLI 的版本（和 init 一样带版本号安装、装完读回校验）。

实施计划：
1. 重构 `init.ts`：把安装与校验、tsconfig、脚本、app ID 这几步抽成函数（新模块 `packages/cli/src/setup-steps.ts`），init 和 upgrade 共用；每步都支持 dry-run（只返回 InitStep，不写文件也不执行命令）。
2. `init --upgrade [--dry-run] [--skip-install] [--platforms …]`（新文件 `commands/upgrade.ts`，init 看到 `--upgrade` 就交给它）：
   - 平台：优先用 `--platforms`，否则读 quiesco.config 的 apps；读不到就报错退出。
   - 版本：重装 Quiesco 包到 CLI 的版本（package.json 里已有的 + 必需的；`@cucumber/cucumber`、`playwright` 不动），装完读回校验；已经是这个版本就跳过安装。
   - 文件：cucumber 配置里原样的 `paths: ['features/**/*.feature'],` 行就删掉，别的 paths 只提示；tsconfig 能解析就加上，不能就提示；app.json 缺 ID 就写回，再把 config 里 init 生成的占位行（`'com.example.app', // TODO: expo.…`、`'myapp' … // TODO: expo.scheme`）换成同样的值；补缺的 e2e 脚本；入口是 registerRootComponent(App) 时包上 `<QuiescoRoot>`。
   - 不新建 features/ 里的文件，不改 metro / 入口的 agent import（这些在 doctor 里已有检查和修法）。
   - 重复执行结果不变（第二次全部是 skipped）。
3. init（新项目）的 #34：app.json 有 `expo` 但缺 ID ⇒ 写回 `ios.bundleIdentifier`（选了 ios 时）、`android.package` 和 `scheme`（选了 android 时）。ID 用 `com.anonymous.<slug 去掉非字母数字，小写>`（和 Expo prebuild 给 Android 的默认值一样），scheme 用 slug（只留合法字符）；以数字开头就加前缀 `app`。有 app.config.* 时不改 app.json，写占位符并列为下一步（和现在一样）。
4. doctor：
   - #35「cucumber paths」：cucumber 配置设了 `paths` ⇒ warn。
   - #35「tsconfig」：缺 `allowImportingTsExtensions`（文本匹配，带注释的也能查），且 features/ 里有 `from './x.ts'` 这种相对 .ts 导入 ⇒ fail；没有这种导入 ⇒ 不报。
   - #35「scripts」：config 里有某平台、但缺 `e2e:build:<平台>` 脚本 ⇒ 加一个 `info` 级别（CheckStatus 新增 info，不算 warn、不算 fail）。
   - #34「app IDs」：config 的 bundleId / package / devClient.scheme 与 app.json 比，不一致 ⇒ fail；app.json 缺这个值 ⇒ fail（说明 build 会用 Expo 的默认值）；config 文件里还有 `// TODO: expo.` ⇒ fail；有 app.config.* ⇒ warn（查不了）。构建产物存在时再比：Android 读 `android/app/build.gradle` 的 applicationId 和 AndroidManifest 里的 scheme；iOS 在 macOS 上用 `plutil` 读 binaryPath 里 Info.plist 的 CFBundleIdentifier。
   - 修法里都提示可以用 `npx quiesco@latest init --upgrade`。
5. core `android.ts`：`am start` 失败时用 `pm path <pkg>` 查包有没有装；没装 ⇒ 说明 binaryPath 的 applicationId 可能和 apps.android.package 不同、建议跑 doctor；装了但用 devClient ⇒ 用 `cmd package resolve-activity` 查 scheme 能不能打开这个包，打不开就说 scheme 没注册。
6. 测试：init.test、新的 upgrade.test、doctor.test、android.test。
7. 文档三语：cli.mdx（init 第几步写 ID、`--upgrade`、doctor 新检查）、troubleshooting（升级旧项目；Android 启动失败）。
8. 实测：新建空白模板项目，用本分支的包跑 init → doctor → build android → e2e:android；再用 0.1.x 风格的旧文件跑 `init --upgrade` ⇒ doctor 通过。

- [x] 1 重构 setup-steps（`packages/cli/src/setup-steps.ts`；init.ts 改用它）
- [x] 2 init --upgrade（`commands/upgrade.ts`；测试 6 个：升级、再次执行不变、--dry-run、改不了的项、平台来源、经由 init 进入）
- [x] 3 init 写回 app.json 的 ID（测试 2 个 + 改了原有测试的期望值）
- [x] 4 doctor 新检查（cucumber paths warn、tsconfig fail、build scripts info、app IDs：占位符 / 与 app.json 比 / 与构建产物比；版本不一致的修法里也提示 `init --upgrade`）；测试 5 个
- [x] 5 android am start 诊断（`launchFailure`：`pm path` + `cmd package resolve-activity`）；测试 1 个（3 种情况）
- [x] 6 测试；`pnpm check` exit 0（862 个测试）
- [x] 7 文档三语（cli.mdx：init 第 2 步、`--upgrade` / `--dry-run`、新小节「升级项目」、doctor；troubleshooting：Android 启动失败、升级）；docs:check；plugin references
- [x] 8 实测：A（新项目 init）和 B（0.1.1 项目 upgrade）都通过 doctor，Android 构建 + e2e 各 1 scenario passed；am start 诊断两种情况在真机上都确认
- [x] HU 确认提交 / PR（PR base 为 fix/error-diagnostics）
- **Status:** complete

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
| 2026-11-16 | `init --upgrade` 直接改文件并逐项列出（另有 `--dry-run`）；五项都修；还要升级 Quiesco 包的版本 | HU 选的；版本升级是 HU 另外提的 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| 想用 AGENT_TIMEOUT 测 #32，但 host 有 5s 余量（HOST_MARGIN_MS），测试超时 | 1 | 改为让 agent 断线（AGENT_DISCONNECTED） |
| `git checkout .planning/.active_plan` 把 init-session 改好的指针还原了 | 1 | 用 set-active-plan.sh 重新指向本计划 |
| lint：解构剩余参数里的 `_depth` 没用到 | 1 | 改为显式构造 Control |
| K.A 的提交信息 subject 后少了空行；改写 + force-push 被 auto mode 拒绝 | 1 | 保持原样，squash 合并时修 |
| K.B 分支从 main 拉出，没有计划文件 | 1 | 改为叠在 fix/error-diagnostics 上 |
