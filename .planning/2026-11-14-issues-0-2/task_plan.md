# Task Plan: 处理 GitHub issues #1–#9（0.1.1 之后）

## Goal
逐个解决 h2nology/quiesco 的 9 个 open issue（均来自同一位用户在 Expo SDK 58 + expo-router + cucumber 项目上的实测反馈），每个修复附测试与文档，用实跑验收后关闭 issue，最后发一个新版本。

## Next Step
I.A（PR #10）、I.B 的 PR 等 HU review / merge（两个分支都改了 `.planning/2026-11-14-issues-0-2/`，后合并的那个需要 rebase 解决计划文件冲突）。下一步 I.C（#2 #3），从 main 开分支。

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
- [ ] #2 失败信息带当前路由 / 最上层页面（expo-router 可取）
- [ ] #2 「exists but is not visible」尽量给出原因：被其他页面/视图遮挡、在屏幕外、尺寸为 0
- [ ] #2 「still busy」只在 tracker 真的忙了有意义的时长时附加（4ms 不算）；与 idle-state.json 不矛盾
- [ ] #2 artifact 增加精简元素树：只含有 testID / 文本 / label 的节点及其可见性
- [ ] #3 agent 连接时上报 bundle 身份（构建时间或 hash），写进 `[quiesco] agent connected: …`
- [ ] #3 host 侧：项目源码比 bundle 新、或 Metro 不监听文件（如 `CI` 已设置）时警告；`quiesco doctor` 在交互环境检测到 `CI` 时警告
- **Status:** pending

### I.D API 补充（#4、#6）
- [ ] #4 `app.goBack()`：Android 系统返回；iOS 点导航栏返回按钮，没有则边缘右滑；Web `history.back()`
- [ ] #4 文档说明 iOS 原生 header 返回按钮怎么定位（若支持）；steps 包是否加对应 step
- [ ] #6 `backdoor()` 参数改为 `Jsonify<T>` 式检查，接受无索引签名的 interface
- [ ] #6 按 D3 决定是否做声明合并的类型注册表（`interface Backdoors`），名称 / 参数 / 返回值都受检；类型测试（tsd / expectTypeOf）
- **Status:** pending

### I.E 工作流自动化（#5）
- [ ] 类似 Playwright `webServer`：`devClient.metroUrl` / `apps.web.url` 不可达时以 `EXPO_PUBLIC_QUIESCO=1` 启动 `expo start`，等就绪，结束后停止；已在运行则复用；配置可关闭
- [ ] `quiesco build ios|android`：`EXPO_PUBLIC_QUIESCO=1` prebuild + 原生构建，产物写到配置的 `binaryPath`；原生输入（app.json、原生依赖）未变时跳过
- [ ] 文档：快速开始简化为 `quiesco build` + `quiesco test`
- **Status:** pending

### I.F 验收与发布
- [ ] `pnpm check` / `release:check` 全过
- [ ] tarball 装进全新 create-expo-app（含 expo-router），三端按 issue 里的复现步骤逐个验证
- [ ] 每个 issue 回复修复说明并关闭（回复内容先给 HU 看）
- [ ] 版本号按 D5，HU publish + tag
- **Status:** pending

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
| D4：`quiesco.config` 的 `bailOnRepeatedFailure: N`，**默认开启，N=3**；提示信息总是打印（HU 2026-11-14） | 坏状态下不再每步等满超时 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
