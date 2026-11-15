# Task Plan: 处理 GitHub issues #1–#9（0.1.1 之后）

## Goal
逐个解决 h2nology/quiesco 的 9 个 open issue（均来自同一位用户在 Expo SDK 58 + expo-router + cucumber 项目上的实测反馈），每个修复附测试与文档，用实跑验收后关闭 issue，最后发一个新版本。

## Current Phase
I.F

## Next Step
I.F 验收已在本地集成分支 `integration/0.2.0` 上完成（三端全过）。全部完成：#10–#14 已合并，npm 0.2.0 已发布，tag v0.2.0，9 个 issue 已回复并关闭。

## 背景
- 前置：npm 0.1.1 已发布（tag v0.1.1，`.planning/2026-11-14-release/`）。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md`「工作约定」：先出计划再写代码、测试与 step 禁止 sleep、宣称完成前实跑验收、待确认事项问 HU；用户个人信息不写进包、不发给外部服务。
- issue 原文摘要见 findings.md。

## Issue 一览与分组

| # | 类型 | 标题 | 阶段 |
|---|------|------|------|
| 7 | bug | `quiesco test` 无 `--help`；前导 `--` 被原样转给 runner | I.A |
| 8 | bug | init 生成的 cucumber.mjs 带 `paths`，单文件运行仍跑全部 feature | I.A |
| 1 | bug | 软重置不重置 Expo Router 导航状态 | I.B |
| 9 | enh | 重置后连续相同失败：提示 + 提前停止 + 重置后校验初始状态 | I.B |
| 2 | enh | 目标在别的页面时，失败信息误导（指向同步 / 渲染） | I.C |
| 3 | enh | 被测 App 跑的是旧 JS bundle 时没有提示 | I.C |
| 4 | enh | 跨平台 `app.goBack()`（iOS 上 pressBack 不可用） | I.D |
| 6 | enh | 类型化 backdoor：普通 interface 过不了 `JsonValue` | I.D |
| 5 | enh | 自动启动 Metro + `quiesco build` 命令 | I.E |

依赖：#9 的「重置后校验」和 #2 的「当前路由」共用一个 agent 侧的路由探测；#1 修好后 #9 的场景才不再是默认路径。#5 管理 Metro 后，#3 的一部分（CI=1 启动）自然消失，但 bundle 身份上报仍要做。

## Phases

### I.A CLI 小修（#7、#8）
- [x] #7 `quiesco test --help` / `-h`（只看 `--` 之前）：选项、其余参数转给 runner 的说明、示例；`quiesco --help` 提示它；缺平台的报错也提示它
- [x] #7 以第一个 `--` 分割：之前解析 Quiesco 选项，之后原样转给 runner，`--` 本身丢弃；单元测试覆盖 `-- --tags @x`、`-- --name "…"`、`--` 后的 `--help`/`--workers` 归 runner
- [x] #8 init 生成的 `cucumber.mjs` 去掉 `paths`；`examples/todo-app/cucumber.mjs` 同步去掉；init 测试断言无 `paths`
- [x] 文档 en/ja/zh `cli.mdx`：`--` 与 `--help`
- [x] 实测（examples/todo-app，dry-run）：修前 `cucumber-js features/actions.feature` 有弃用警告、跑 86 个场景；修后 `quiesco test --platform web features/actions.feature` 只 5 个、无警告；`-- --tags @REQ-DEMO-001` 过滤正常（5 个）
- [x] `pnpm check` 679 通过；`pnpm docs:check` 通过
- **Status:** complete（2026-11-14；PR 待 merge）

### I.B 软重置与导航状态（#1、#9）
- [x] 调查 agent reset 与 expo-router 58（容器无 resetRoot ⇒ 用 `reset(state)`；见 findings「I.B」）
- [x] #1（D1=a）：agent 挂载时快照 Expo Router 初始 root state，软重置时恢复（onReset 之后、remount 之前）；无需配置
- [x] 重置后路由校验：与本次 JS 上下文第一次重置后的路由比较，不同 ⇒ `RESET_FAILED`（step navigation，给出两个路由）
- [x] D2：`reset.expectVisible`（任意 App；软 / 硬重置后都检查）
- [x] #9（D4）：`bailOnRepeatedFailure` 默认 3：连续相同失败 ⇒ 提示（含当前路由）+ 跳过其余；`false` 只提示；cucumber / jest / vitest 都支持
- [x] protocol `route` 方法 + Driver `currentRoute()`（I.C #2 复用）
- [x] 文档 en/ja/zh `api.mdx`（软重置与导航、配置表 2 行、RESET_FAILED 步骤）；示例 App 加 `soft-reset.feature`（回归）
- [x] 实测：复现 App（scratchpad `ib/smoke`）web 修前 1/4（34.7s）→ 修后 4/4（1.5s）；iOS 4/4、Android 4/4；#9 场景 web：3 次 RESET_FAILED 后提示并跳过 2 个（1.6s）；示例 App web 全套 75 passed / 13 skipped（与修改前相同）
- [x] `pnpm check` 694 通过；`docs:check` 通过
- **Status:** complete（2026-11-15；PR 待 merge）

### I.C 失败诊断（#2、#3）
- [x] #2 失败信息带当前路由（Expo Router）
- [x] #2 「exists but is not visible」给出原因：不在最上层的页面 / 祖先样式隐藏 / 窗口外 / 被裁剪 / 无尺寸 / 未布局
- [x] #2 可见性规则修正：react-native-screens 原生栈中被后续页面覆盖（透明模态除外）或 activityState 0 的页面上的元素 ⇒ 不可见（iOS / Android 之前误判为可见，点击报 "no native view in a window"）
- [x] #2 「still busy」只在同步预算 ≥ min(250ms, timeout/4) 时附加
- [x] #2 证据 `elements.json`（route + 有 testID / label / 自身文本的元素，含可见性与原因）
- [x] #3 bundle 身份（builtAt / watching / reason）经 hello 上报；不监听时源码更新 ⇒ 警告；CI 启动的 Metro ⇒ 警告（host 非 CI 时）；连接日志写 bundle 描述
- [x] #3 doctor：交互终端 CI 为真 ⇒ warn
- [x] 文档 en/ja/zh：api.mdx（可见性、artifacts）、troubleshooting.mdx（旧代码）
- [x] 实测：复现 App web / iOS / Android 两条消息正确；web export 后改文件 ⇒ 警告；CI=1 Metro ⇒ 警告；示例 App 全套 iOS 82 passed / 6 skipped、Android 83 / 5
- [x] `pnpm check` 709 通过；`docs:check` 通过
- **Status:** complete（2026-11-15；PR 待 merge，叠在 #11 上）

### I.D API 补充（#4、#6）
- [x] #4 `app.goBack()`：Android 返回键（先关键盘）；Web 浏览器后退；iOS 经 XCUITest runner 点导航栏返回按钮（`BackButton` / 左三分之一），没有则左边缘右滑；Expo Router 下路由未变 ⇒ ASSERTION_FAILED
- [x] #4 iOS 原生 header 返回按钮由 goBack 处理（runner 新端点 `/navigationBar`、`/edgeSwipeBack`）；steps 包新增 `goBack` 步骤；iOS `pressBack` 提示指向 goBack
- [x] #6 未声明时参数用 `JsonCompatible<T>`（接受 interface；Date / 函数 / Map / undefined 报类型错误）；结果 `T`（默认 JsonValue，不再限制为 JsonValue）
- [x] #6（D3）`Backdoors` 声明合并注册表（在 protocol 声明，agent / core 再导出；`declare module '@quiesco/agent'` 即可，两边共用）：名称、参数、结果 / 注册函数都受检；未声明的名称报错，动态名称用 `as keyof Backdoors`
- [x] 测试：core 新增 typecheck（`backdoor-types.test-d.ts`）；示例 App 用 `src/backdoors.ts` 声明全部后门 + `src/backdoors.type-test.ts`（@ts-expect-error）；ios-runner / driver / runtime 单元测试
- [x] 实测：示例 App `go-back.feature`（REQ-DEMO-011）web / iOS / Android 2/2；smoke App 无 header 页 iOS 边缘滑动 1/1
- [x] 文档 en/ja/zh：api.mdx（goBack、类型化后门）、platforms.mdx、steps.mdx、steps README
- [x] `pnpm check` 718 通过；docs:check 通过
- **Status:** complete（2026-11-15；PR 待 merge，叠在 I.C 上）

### I.E 工作流自动化（#5）
- [x] Metro 管理（类似 Playwright webServer）放在 `quiesco test`：devClient.metroUrl / apps.web.url 无响应且在本机 ⇒ `npx expo start --port {port}` + EXPO_PUBLIC_QUIESCO=1，就绪后跑 runner，结束 / Ctrl-C 停进程组；已在运行则复用；config `devServer { autoStart, command, timeoutMs }`；日志 `artifacts/metro.log`
- [x] `quiesco build ios|android [--force]`：prebuild + xcodebuild（从 binaryPath 解析 derivedData / configuration / scheme）/ gradlew assemble<Variant>（必要时复制到 binaryPath）；Debug 原生输入未变则跳过，Release 总是构建
- [x] init：配置注释、`e2e:build:ios` / `e2e:build:android` 脚本、下一步说明
- [x] 文档：en/ja/zh native.mdx、cli.mdx、api.mdx（devServer）；README
- [x] 实测：示例 App 自动启停 Metro（iOS 1 场景）、SIGINT ⇒ Metro 停止；smoke `quiesco build ios`（成功、重跑跳过）+ iOS 1/1；`quiesco build android`（2m47s，重跑跳过）+ Android 1/1
- [x] `pnpm check` 728 通过；docs:check 通过
- **Status:** complete（2026-11-15；PR 待 merge，叠在 I.D 上）

### I.F 验收与发布
- [x] `pnpm check` / `release:check` 全过（本地集成分支 `integration/0.2.0`：730 → 修复后 731）
- [x] tarball 装进全新 create-expo-app（含 expo-router），三端按 issue 里的复现步骤逐个验证（详见 progress「I.F」）
- [x] 验收中发现的问题已修（集成分支 2 个 commit）：#3 改 step 文件误报 stale；doctor 提示改为 quiesco build；文档补 `import type {}`
- [x] 修复 commit cherry-pick 到 #14 分支（HU 2026-11-15）并 push，PR 说明已补
- [x] merge #10–#14（HU 2026-11-15 让 Claude 合并；merge commit，依次改 base 为 main；冲突：#11 计划文件、#14 test.ts，按集成分支解决；每步 pnpm check）⇒ issue #1–#9 自动关闭
- [x] merge 后 main 上：版本 0.2.0 commit、release:check
- [x] 每个 issue 贴回复（replies.md，HU 确认后 2026-11-15 贴出）
- [x] HU npm publish（11 包 0.2.0，registry 确认）；tag v0.2.0（148b77c）已 push
- **Status:** complete（2026-11-15）

## 待 HU 决定
- D1–D6 全部已定（见 Decisions Made）。
- **D1（#1）**：expo-router 的导航重置放在哪？(a) agent 检测到 expo-router 时在软重置里自动回到初始路由（推荐，用户零配置）；(b) init 生成 onReset 钩子 + doctor 警告；(c) 两者都做。
- **D2（#9）**：「初始状态」默认怎么判定？只看初始路由，还是要求在 `quiesco.config` 里配置一个必须可见的元素？
- **D3（#6）**：只做 `Jsonify<T>`，还是连声明合并的 `Backdoors` 类型注册表一起做？
- **D4（#9）**：要不要提前停止选项，叫什么（`--bail-on-repeated-failure` / config `bailOnRepeatedFailure: N`）？
- **D5**：发布版本：这些含新 API（goBack、build 命令），建议 `0.2.0`；还是 #7/#8/#1 先出 `0.1.2` 补丁？
- **D6**：分支 / PR 粒度：每个 issue 一个 PR，还是按阶段一个 PR？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| D1=a：agent 检测到 expo-router 时，软重置自动回到初始路由（HU 2026-11-14） | 用户零配置；Expo 推荐的导航，多数用户会碰到 |
| D3：`Jsonify<T>` + 声明合并的 `Backdoors` 类型注册表都做（HU 2026-11-14） | 名称 / 参数 / 返回值都受检 |
| D5：版本 `0.2.0`（HU 2026-11-14） | 含新 API（goBack、build 命令） |
| D6：每个阶段一个 PR（I.A–I.E 各一个）（HU 2026-11-14） | |
| D2：重置后初始状态默认看初始路由（expo-router）；`quiesco.config` 可选配置一个必须可见的元素（HU 2026-11-14） | 零配置；非 expo-router 项目也能用 |
| I.C 分支从 I.B 分支开、PR 叠在 #11 上（2026-11-15） | #2 复用 I.B 的 `route` |
| I.E：Metro 启停放在 `quiesco test`（CLI 主进程），不放 core Lifecycle（2026-11-15） | 并行 worker 是多个进程，各自启停会冲突、互相停掉；代价是直接跑 cucumber-js 不自动启动 |
| D4：`quiesco.config` 的 `bailOnRepeatedFailure: N`，**默认开启，N=3**；提示信息总是打印（HU 2026-11-14） | 坏状态下不再每步等满超时 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| I.B：示例 App iOS 3 个场景回归（RESET 未处理的 dev toast 遮挡） | 1 partial 快照 ⇒ 仍未处理；2 target 到下层 navigator ⇒ 仍未处理；3 完整 state payload ⇒ 仍未处理 | 4 dispatch 后等 state 变化再 remount ⇒ 通过（原因见 findings「I.B 回归」） |
| I.E：pnpm check lint 失败（build.test.ts 的 `let ctx`） | 1 | 改 const |
| I.D：Android goBack 在新建待办页失败（路由未变） | 1 | 自动聚焦输入框弹出键盘，第一次返回只关键盘 ⇒ agent 先关键盘 |
| I.D：core 类型测试全部「Unused @ts-expect-error」 | 1 | nodenext 下 `../src/driver` 缺扩展名 ⇒ Driver 成 any；改 `.js` |
| I.D：docs:check 失败（MDX 解析） | 1 | 段落里的 `{#typed-backdoors}` 被当成 JS 表达式 ⇒ 改为 `###` 标题 |
| I.C：iOS / Android 上被覆盖页面的元素被判为可见 | 1 activityState 判断（原生栈里下层仍是 2）⇒ 无效 | 2 按 RNSScreenStack 子顺序判断 ⇒ 正确 |
