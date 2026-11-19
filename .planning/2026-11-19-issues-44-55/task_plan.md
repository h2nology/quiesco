# Task Plan: 处理 GitHub issues #44–#55（0.7.0 之后）

## Goal
解决 h2nology/quiesco 的 12 个 open issue（同一位用户在 0.7.0 + Vitest + Expo SDK 58 Release 构建、iOS 27 模拟器 / Android API 36 模拟器上实测的反馈）。每个修复都配测试和三语文档，实跑验收后回复并关闭 issue，最后一起发下一个版本。

## Current Phase
L.A 根因明确的小 bug（#47、#55、#44）

## Next Step
HU 确认 L.A 的提交 / PR；之后开始 L.B（#45、#46）。

## 背景
- 前置：0.7.0 已发布（`707bade chore(release): 0.7.0`）。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md` 的「工作约定」：先出计划再写代码；测试和 step 里禁止 sleep；宣称完成前要实跑验收；待确认事项问 HU；平台分支只在 fiber-adapter / 存储适配器 / DeviceProvider；用户的个人信息不写进包，也不发给外部服务。
- issue 摘要和代码定位见 findings.md。

## Issue 一览与分组

| # | 类型 | 标题（简） | 阶段 | 难度 |
|---|------|-----------|------|------|
| 47 | bug | Android openNotification 只等 5 s，不看 timeoutMs | L.A | 小 |
| 55 | bug | `quiesco list` 把 `test.beforeEach` 当测试；共享模块里的 hook 只对第一个文件生效 | L.A | 小 |
| 44 | bug | Android 带 refreshControl 的列表 scrollTo 只拖一次就放弃 | L.A | 小 |
| 45 | bug | scrollTo 只露出 1 pt 就停；tap 打到整个 rect 中心；hitTest 不看裁剪 | L.B | 中 |
| 46 | bug | 竖列表里嵌的横列表 scrollTo 失败；scroll 的 distance 无效 | L.B | 中（要先在 iOS 上查原因） |
| 48 | enh | 后台时不能 openUrl（deep link 热启动） | L.C | 中 |
| 53 | enh | iOS setLocale 要求 CFBundleLocalizations | L.C | 小–中 |
| 52 | enh | type() 一次写入整段文本，要逐字输入 | L.C | 中 |
| 54 | enh | doctor / build 假定测试项目就是 Expo app，要支持 appDir | L.D | 中–大 |
| 49 | enh | Android 无法用真实触摸操作 app 自己的对话框窗口 | L.E | 中 |
| 50 | enh | iOS inline DateTimePicker 的日期点不到 | L.E | 大（要调研） |
| 51 | enh | iOS system.* 看不到其他进程的 UI；两端都没有 system.type | L.E | 大（要调研） |

分组依据：L.A 是根因明确的小 bug；L.B 是 scroll / tap 的正确性（都改 runtime.ts / visibility / hit-test，放一起）；L.C 是 device / 输入 API 的扩展；L.D 是 CLI；L.E 是 system UI 和原生控件，要先在模拟器上调研再定方案。

## 待决定事项（2026-11-19：D1、D2、D7、D8 由 HU 选了推荐项；D3–D6 按推荐默认执行）
| ID | 问题 | 推荐 |
|----|------|------|
| D1 | #45 修哪几处 | 三处都修：① `scrollTo` 停下的条件改为「目标的中心点在滚动容器的可见区域内」（不是 ratio > 0）；② native tap 的点改为「元素可见部分（按祖先裁剪后的 rect）」的中心；③ `hitTest` 考虑 `clipsContent` 祖先的裁剪，点落在被裁掉的部分 ⇒ `ELEMENT_OBSCURED`。 |
| D2 | #48 怎么支持后台 openUrl | `app.openUrl` 在后台时不再报错：从 app 外打开（iOS `simctl openurl`，Android `am start -a VIEW -d … <package>`），iOS 出现「在 … 中打开？」时自动点「打开」，然后等 app 回到前台并 idle。不另加 `device.openUrl`。 |
| D3 | #53 setLocale 的校验 | 去掉 CFBundleLocalizations 前提；重启后读 agent 报告的 JS locale（`Intl` / expo-localization 同源）。和请求的不一致才报错，错误信息里提 CFBundleLocalizations 作为可能原因。 |
| D4 | #52 的 API 形式 | `type(target, text, { perCharacter: true })`：每个字符单独提交（iOS `insertText` / Android `commitText`），每个字符之后等 idle（不加固定延时）。不做 `delayMs`（违背禁止固定等待的约定）。 |
| D5 | #54 appDir | `quiesco.config` 加 `appDir`（相对 config 文件），`--app-dir` 可覆盖；doctor 的 app 检查、`build`、`init --upgrade` 都用它。runner 包检查改为按 config 里实际的 runner（Vitest / Jest / Cucumber）来查。 |
| D6 | #55 共享 hook 的处理 | `list` 忽略 `test.beforeEach / afterEach / beforeAll / afterAll`（以及 `describe` 级同名）；runners 文档写明 hook 要在每个文件里注册或用 `setupFiles`；init 生成的 vitest config 带 `setupFiles: ['e2e/setup.ts']` 的注释示例（不默认生成文件）。 |
| D7 | #49–#51 的范围 | 先做 L.E.0 调研再定。初步：#49 Android 的 `system.*` 包含 app 自己的非主窗口（按 window 区分而不是按 package）；#51 Android 加 `system.type`（`input text` / 剪贴板）；iOS 的「其他进程 UI」「inline picker 的日期」「system.type」要看现有 iOS system UI runner 能做到哪一步，做不到的写进文档。 |
| D8 | 版本号 | 加了新 API / 新配置 ⇒ 0.8.0；所有阶段完成、三端验收后一起发。也可以先把 L.A + L.B 作为 0.7.1 发出去。 |

## Phases

### L.0 调研与计划
- [x] 读 12 个 issue，写 findings
- [x] 初步代码定位（见 findings.md）
- [x] HU 确认 D1–D8
- **Status:** complete

### L.A 根因明确的小 bug（#47、#55、#44）
分支 `fix/issues-44-47-55`。
- [x] #47 `openNotification(title, { timeoutMs })`：provider 接口多了 `timeoutMs`；Android 去掉固定 5 s，iOS 去掉固定 10 s；默认 10 s（和 `system.*` 的 `SYSTEM_WAIT_MS` 一致——DeviceHost 拿不到 `sync.timeoutMs`，见 Decisions）；iOS 找横幅的时间上限改为 min(2 s, timeoutMs/2)，短超时也会去通知中心找；错误消息带 `within Nms`。测试：device-state（默认值 / 传入值 / 非法值）、android（700 ms 内失败）、ios-runner（600 ms，打开过通知中心）
- [x] #55 `@quiesco/vitest` 的 list：Vitest 静态解析把 `test.<x>(…)` 都当测试 ⇒ 按源码位置（1-based line/column，TS 也映射回原始源码，已实测）判断是否 `*.beforeEach/afterEach/beforeAll/afterAll/aroundEach/aroundAll/onTestFailed/onTestFinished(`，是就去掉。新 fixture `packages/vitest/test/fixtures/list-hooks`（.mjs + .ts）。runners.mdx 三语加「共享 hook 放 setupFiles」；init 生成的 vitest config 带注释掉的 `setupFiles` 示例
- [x] #55 实测：Vitest 5.1 + `isolate: false` 下，setupFiles 里的 beforeEach 对每个文件都执行，共享模块里的只执行第一个文件（hits=2 / shared=1）；example app web 上用 setupFiles 的 `test.beforeEach(({ app }) => …)` 在两个文件的 5 个测试前都执行
- [x] #44 `findScrollable`：第一个 host 是 `AndroidSwipeRefreshLayout` 时取它的子节点（`SCROLL_WRAPPERS`）。单测用 issue 的树。example app playground 的 200 行 FlatList 加了 `refreshControl`
- [x] #44 实测：Android 去掉修复 ⇒「长列表滚动到指定行和两端」失败（scrollToEdge bottom 后 row-200 不可见），加上修复 ⇒ 通过；actions.feature Android / iOS / web 各 5/5
- [x] `pnpm check` exit 0（910 个测试），`docs:check --no-mint` 通过，plugin references 已重新生成
- [ ] HU 确认提交 / PR
- **Status:** in_progress

### L.B scroll / tap 正确性（#45、#46）
- [ ] #45 按 D1 改 scrollTo 停止条件 / 可见部分中心 / hitTest 裁剪；单测（header + 列表，目标只露出 1 pt）
- [ ] #46 调研：iOS 上嵌套横向 FlatList 的 offset 读取和 drag 距离（每次 ~445 pt 而不是 240 pt；疑似 drag 方向取了外层容器的 span 或 distance 被 `span * 0.45` 截断逻辑以外的地方覆盖）；定位后修复并加 example app 场景
- [ ] iOS / Android / web e2e 实跑
- **Status:** pending

### L.C device / 输入 API（#48、#53、#52）
- [ ] #48 按 D2 实现后台 openUrl（core `driver.ts:623` / `device.ts:572` 的前台检查 + providers）
- [ ] #53 按 D3 改 `device.ts:399` 的校验，agent 报告 JS locale
- [ ] #52 按 D4 加 `perCharacter`（protocol + agent + native iOS / Android）
- [ ] api.mdx 三语；e2e 实跑
- **Status:** pending

### L.D CLI：appDir（#54）
- [ ] config schema 加 `appDir`；doctor 把检查分成「app」和「测试项目」两组；build / init --upgrade 用 appDir
- [ ] runner 包检查按实际 runner
- [ ] 用 monorepo 结构（app/ + e2e/）的 fixture 测试；cli.mdx 三语
- **Status:** pending

### L.E system UI 与原生控件（#49、#50、#51）
- [ ] L.E.0 调研：Android uiautomator dump 里 app 对话框窗口的节点；iOS system UI runner 现在怎么取节点、能否查询 SafariViewService / 分享面板 / 键盘 / app 内 UIKit 控件的 accessibility 元素
- [ ] 根据调研和 D7 定方案（再问 HU）
- [ ] 实现 + 文档（platforms.mdx 写明限制）
- **Status:** pending

### L.F 发布
- [ ] CHANGELOG、版本号（D8）、三端全量 e2e
- [ ] 回复并关闭 #44–#55
- **Status:** pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| D1 #45 三处都修 | 只改一处仍会留下静默点错的路径 |
| D2 #48 app.openUrl 直接支持后台 | 不加新 API，用户直觉写法就能用 |
| D7 #49–#51 先调研 | iOS 能力取决于现有 system UI runner，先看清再定 |
| D8 全部完成后发 0.8.0 | 有新 API / 新配置 |
| #47 默认等 10 s（不是 sync.timeoutMs） | DeviceHost 没有 sync 配置；和 system.* 的默认值一致，调用方可传 timeoutMs |
| #44 按 host 名跳过 AndroidSwipeRefreshLayout | 结构判断（同 rect）会和内容不足一屏的普通 ScrollView 混淆 |
| #55 按源码判断 hook 调用 | Vitest 静态解析的结果里没有调用的方法名，只有位置 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
