# Task Plan: 测试进度条 + Quiesco UI

## Goal
1. `quiesco test` 运行时在终端底部常驻一个进度条（总数、已完成、通过 / 失败 / 跳过、当前测试）。
2. 仿照 Vitest UI 新增 `quiesco ui`：浏览器里看到测试树，点击运行全部 / 某个文件 / 某个测试，实时看到已完成的测试、
   进度条、失败信息和 Quiesco 证据（截图、元素树、空闲状态、日志）。
3. cucumber / vitest / jest 三个 runner 全部支持；附测试、三语文档，在 examples/todo-app 上实跑验收。

## Current Phase
P7

## Next Step
P7：三语文档（cli.mdx：进度条 / `--no-progress` / `quiesco list` / `quiesco ui`；新 UI 页面；runners.mdx：Vitest `quiescoPlugin()`、Jest 自定义 reporters 时加 `@quiesco/jest/reporter`；cucumber `paths` 限制）、README、packages/ui/README；iOS / Android 实跑（进度条 + UI）；`pnpm check`。

## 背景
- 前置：0.2.0 已发布（`.planning/2026-11-14-issues-0-2/`）。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md`「工作约定」：先出计划再写代码、测试禁止 sleep、
  宣称完成前实跑验收、待确认事项问 HU；用户个人信息不写进包、不发给外部服务。
- 现状调研见 findings.md：CLI 只是 `npx <runner>` 子进程，拿不到测试事件；core Lifecycle 不知道总数。

## 已确认的决定（2026-11-15，HU）
| 决定 | 选择 | 理由 |
|------|------|------|
| runner 范围 | cucumber / vitest / jest 全部 | 与「核心与 runner 解耦」定位一致 |
| 进度条形态 | 底部常驻，runner 原输出照常滚动；非 TTY / CI 自动关闭，`--no-progress` 可关 | 不丢 runner 自己的格式化输出 |
| UI 执行模型 | UI 服务常驻（保持 Metro / 设备），每次点击用过滤参数起一次 runner 子进程 | 三种 runner 统一、实现简单；代价是每次多一次 session 启动 |
| UI 前端 | React + Vite，构建产物随包发布 | 组件化，便于测试树 / 详情 / 证据面板 |
| UI/UX 设计 | 用 ui-ux-pro-max 插件设计，并用它做实现后的审查 | HU 指定 |
| reporter 接入（P0 后） | cucumber：CLI 追加 `--format`；Vitest：新增 `quiescoPlugin()` 放进 plugins（init 生成的配置自带）；Jest：preset 自带 reporters；未收到 `hello` 时 CLI 提示 | 命令行 `--reporter(s)` 会替换用户 reporters；不改写用户配置 |
| UI 包 | 独立 `@quiesco/ui`（服务 + React 产物），`quiesco ui` 动态加载，未安装时提示 | CLI 保持轻量 |
| UI v1 范围 | 必做（测试树、运行全部 / 文件 / suite / 单个、实时进度条、错误详情）+ 证据面板 + 搜索 / 过滤 / 排序 + Console 与只读源码 + 设备 / worker 泳道；不做：快照、模块图、覆盖率、可编辑源码、watch 自动重跑 | HU 选择 |
| 版本 | 全部完成并三端验收后一起发 0.3.0 | HU 选择 |
| UI 布局 | 双栏（左测试树、右详情标签页）+ 顶部进度条带，设备泳道只在多 worker 时出现 | HU 选择；视觉稿 https://claude.ai/artifact/2mf3Y9aHqyhxoEd4Wfo7iy |
| UI 多语言 | 中文（简体）/ 日本語 / English；初始 = 上次选择 → 浏览器语言 → 英文；顶栏切换并记住；测试名等用户内容不翻译 | HU 指定（2026-11-15） |
| UI 视觉风格 | A · 现代深色（Dark Mode/OLED；Space Grotesk + DM Sans + JetBrains Mono；紫罗兰强调；环形进度；圆角分层面板），默认暗色可切亮色；token 见 findings「P6 设计说明」 | HU 选择（第一版 Swiss 风被否：太老气） |

## 架构草案
```
runner 进程 (cucumber-js / vitest / jest)
  └─ Quiesco reporter/formatter（各适配器包提供，CLI 自动注入）
       └─ NDJSON 事件 → 本地 IPC（CLI 通过环境变量 QUIESCO_EVENTS 告知地址）
CLI (quiesco test)  ── 事件 → 终端底部进度条
CLI (quiesco ui)    ── 事件 → WebSocket → 浏览器 (React)
                    ←─ 命令（run / cancel / list）
```
- 事件协议（runner 无关）：`runStart{total?}`、`testDiscovered`、`testStart{id,name,file,worker}`、
  `testEnd{id,status,durationMs,error?,evidence[]}`、`runEnd{counts}`。放在哪个包待 P1 定（倾向 `@quiesco/core` 的独立子模块，
  不引入 runner 依赖，满足 depcruise）。
- 证据文件：`Lifecycle.after()` 已返回 files，reporter 把路径带进 `testEnd`；UI 服务只允许读 artifacts 目录内的文件。

## Phases

### P0 查证（不写产品代码）
- [x] cucumber-js：自定义 formatter 拿 `testCase` / `testCaseStarted` / `testCaseFinished` 消息；`--parallel` 下 formatter 是否只在主进程；与用户自己的 `--format` 并存方式；`--dry-run` 列出 pickle（id、名字、feature:行号）
- [x] Vitest 5：reporter API（收集完成时拿总数、单测试开始/结束）；`--reporter` 追加而不替换默认 reporter 的写法；`vitest list --json`
- [x] Jest：自定义 reporter（`onRunStart` / `onTestCaseStart` / `onTestCaseResult`）；`--reporters default --reporters X`；测试名的列出能力（`--listTests` 只有文件）
- [x] Vitest UI 功能清单（以实际 `@vitest/ui` 为准），决定第一版要做 / 不做的项
- [x] 过滤运行单个测试的参数：cucumber `path:line` / `--name`，vitest `file -t`，jest `file -t`（名字含正则字符时的转义）
- [x] IPC 选型：Unix socket / Windows named pipe（`QUIESCO_EVENTS`），fd3 经 npx 丢失不可行；详见 findings
- [x] 汇总已写入 findings「P0 汇总」与「事件协议草案」；HU 已确认接入方式 / UI 包 / v1 范围 / 版本
**Status:** complete

### P1 事件协议与传输
- [x] 定义事件类型（TS 类型 + 版本号字段），NDJSON 编解码，单元测试 —— `packages/protocol/src/run-events.ts`
- [x] 传输：服务端（CLI 侧）监听 + 客户端（reporter 侧）连接；`QUIESCO_EVENTS` 不存在时 reporter 什么都不做 —— `packages/core/src/run-events.ts`
- [x] depcruise 规则：现有 `protocol-is-leaf` / `core-no-test-runner` 已覆盖，无需新增；`pnpm depcruise` 无违规
**Status:** complete

### P2 三个 runner 的 reporter
- [x] `@quiesco/cucumber/events` formatter plugin（`CucumberRunEvents`：testCase 计总数、最严重 step 结果作状态、`willBeRetried`、BeforeAll 失败 → run:error、workerId、`this.log()` → logs、Rule / Outline 行）
- [x] `@quiesco/vitest/reporter` + `quiescoPlugin()`（parseSpecifications 估算 → 每文件修正、concurrencyId−1、logs、未处理错误）；`quiesco()` 打开 includeTaskLocation；todo-app vitest 配置加插件
- [x] `@quiesco/jest/reporter`（总数随文件增长、onTestFileResult 补 skip、testExecError → file:end）；preset 自带 `reporters: ['default', reporter]`
- [x] 失败证据：cucumber After hook / vitest session fixture / jest 环境在 worker 内发 `test:evidence`（id 与 reporter 一致）
- [→P3] CLI 注入（cucumber `--format "file://…":"/dev/null"`）与 `hello` 握手提示：和进度条一起做（需要消费端）
**Status:** complete

### P3 终端进度条
- [x] `quiesco test` 启动 RunEventServer（仅在显示进度条时），env 传给 runner；cucumber 追加 `--format "<file URL of @quiesco/cucumber/events>":"/dev/null"`（从项目解析，解析不到则不加）；runner 退出后 `drain()`
- [x] 没收到 `hello`：按 runner 提示如何接入（cucumber 装包 / Vitest quiescoPlugin / Jest reporters）
- [x] core `RunState`（事件 → 计数 / 总数 / 运行中 / 每个测试状态 / 证据；UI 复用）
- [x] runner 输出管道转发（FORCE_COLOR、COLUMNS 保留颜色与宽度），`StickyTerminal` 底部区域重绘，未完成的半行（cucumber 进度点）留在进度条上方原地补全
- [x] 显示：`▕████░░▏ 12/30  ✓10 ✗1 ↷1  2m13s  ▶ 当前测试`；多 worker `▶ 1:… · 2:…`；估算总数 `~N`；CJK 按双宽截断；结束时最后一行留最终状态
- [x] 非 TTY、`CI`、`--no-progress`、`QUIESCO_PROGRESS=0` 时关闭（原样 stdio）；退出码不变；Ctrl-C 时清掉进度条
- [x] 单元测试：RunState 7、渲染 / StickyTerminal（虚拟终端）/ test 命令 / 真实子进程 14
- [x] 实跑（todo-app web，`script` 伪终端 + 虚拟终端回放）：cucumber 5/5、vitest 7/7（~7 估算）、jest 7/7、cucumber `--workers 2` 显示两个 worker
- [ ] Windows：`--format` 的引号转义与临时文件目标未在 Windows 上验证（无 Windows 机器）
**Status:** complete

### P4 测试发现（UI 用）
- [x] 协议 `TestList`；各适配器 `@quiesco/<runner>/list` 入口（子进程，在项目里用项目自己的 runner），id 与 run events 一致
  - cucumber：编程 API dry-run，formats / plugins 清空（不覆盖报告文件，已在 todo-app 确认）
  - vitest：`createVitest` + `parseSpecifications` 静态解析（`test.each` 一项）
  - jest：collect-only（`-t '(?!)'`、list reporter、no-op globalSetup/Teardown、`QUIESCO_LIST=1` 环境不启动设备）
- [x] core `listTests()`（解析项目里的 list 入口、起子进程、读回 JSON；未安装时返回错误而非抛出）
- [x] 新命令 `quiesco list [--runner] [--json] [runner 参数]`
- [x] 测试 24 个（含三 runner 真实列出）；实跑 todo-app：cucumber 90、vitest 7、jest 7
- [→P5] 文件变化后重新发现（UI 服务里 watch）
**Status:** complete

### P5 UI 服务 `quiesco ui`
- [x] 新包 `packages/ui`（`@quiesco/ui`，依赖 core / protocol / ws 8.22.1）；CLI 用 `resolveFrom` 动态加载，未安装时提示 `npm i -D @quiesco/ui`
- [x] 命令 `quiesco ui [--platform] [--runner] [--workers] [--port] [--no-open] [runner 参数]`；只监听 127.0.0.1；交互终端才自动开浏览器
- [x] 安全：随机 token（URL → HttpOnly SameSite=Strict cookie）、Host / Origin 校验（防 DNS rebinding）、CSP、nosniff；证据只读 artifacts 目录内（realpath 防穿越），源码只读已列出的测试文件，非媒体一律 text/plain
- [x] WebSocket `/ws`：welcome（信息 + 列表 + RunState 快照 + 运行中 + 已有输出）→ list / event / run / output / notice；客户端 run(all|file|tests) / cancel / list
- [x] core：`RunState.snapshot()` / `fromSnapshot()`，浏览器可用的子路径 `@quiesco/core/run-state`
- [x] 运行：同一时间一次（忙时 notice）；`targetArgs`（cucumber `file:l1:l2`、vitest `file:line`、jest `--runTestsByPath` + 转义锚定 `-t`）；以 `quiesco test` 同样的方式起 runner（runner 命令、workers、cucumber formatter、用户参数，目标放最后）；进程组 SIGINT 停止，10 s 后 SIGKILL
- [x] 运行指定测试时，丢弃范围外测试被 Vitest / Jest 过滤报成的 skipped，总数改为选中数（实跑发现）
- [x] Metro 在 UI 存续期间保持；测试文件所在目录变化 → 去抖后重新列出（运行中排队）
- [x] 测试：targets 5、服务端 10（含真实子进程、取消、中途连接、安全）、CLI ui 6、RunState 快照 1
- [x] 实跑（todo-app web，脚本客户端）：cucumber 90 个列出、选一个运行通过；vitest / jest 选一个运行通过，范围外不再被标 skipped
- [ ] 已知限制：cucumber 配置里有 `paths` 时，命令行路径是追加而非替换（cucumber-js 行为），会多跑；文档写明
**Status:** complete

### P6 UI 前端（React + Vite）
- [x] **设计先行**（A · 现代深色定稿，ui-ux-pro-max）
- [x] 实现：`packages/ui/web/`（connection / model / App / TestTree / Detail / icons / styles），构建进 dist/web，根 build 包含
- [x] 顶栏（项目·runner·平台、搜索 `/`、连接状态、主题、停止、全部运行）；进度带（环形三段、done/total、用时、开始阶段提示、多 worker 设备泳道）
- [x] 左侧测试树：ARIA tree + roving tabindex（↑↓←→ Enter Home End，`r` 运行焦点项）、分段过滤（全部 / 失败 / 运行中 / 跳过 / 通过）、排序、重新列出、文件运行 / 单测运行按钮、文件级错误
- [x] 右侧详情：状态胶囊 / 位置 / 设备 / 用时 / 重试次数、重跑；Report（错误、diff、堆栈、证据提示）、Evidence（截图放大 dialog、视频、JSON/文本文件）、Console（本测试日志 + runner 输出）、Source（只读、测试行 + 失败行高亮并滚动到位）
- [x] 断线横幅 + 指数退避重连；token 连上后从地址栏移除；运行结束 aria-live 播报；未收到事件时的接入提示；主题记忆 + 系统偏好初值
- [x] Playwright 冒烟测试（`packages/ui/test/web.test.ts`：列出、行内运行、失败 + 证据图加载、键盘 ↑ + r、主题切换、无页面错误）
- [x] ui-ux-pro-max 审查：对比度修正 3 处、375px、reduced-motion 等（详见 findings「P6 实现记录」）
- [x] 实跑 todo-app web（截图验证，含真实失败与证据）
- [x] 多语言（中 / 日 / 英）：`web/src/i18n.tsx` 类型化词典（缺 key 编译失败）+ 占位符；顶栏语言切换（记住）；`<html lang>`；中日文用系统 CJK 字体（`:lang()`，不打包）；服务端 notice 加 `code` 由页面翻译；
      测试：词典完整性 / 占位符一致 / 语言检测单测，浏览器测试切换日语并刷新保持、zh-CN 浏览器自动中文；实跑截图（日语暗色、中文亮色），修正日语「接続中」→「接続済み」
**Status:** complete

### P7 文档与验收
- [ ] 三语文档：`cli.mdx`（`--no-progress`、`quiesco ui`），新增 UI 页面；README 提及
- [ ] examples/todo-app：web 三个 runner 各跑一次进度条；UI 中点击运行单个测试 / 文件 / 全部；iOS、Android 至少各一次
- [ ] `pnpm check` 全绿；`check:prod-strip` 不受影响
**Status:** in_progress

## 待用户确认
（P0 后的问题已全部确认，见决定表）

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| P3 实跑：伪终端报告 0 列 → 渲染宽度 0、进度条为空、半行按 1 列算行数（光标上移 40 行） | 1 | `columns()` 0 时按 80 |
| P3 实跑：Jest 全部通过却显示 failed：`onRunComplete` 时 `results.success` 尚未计算 | 1 | 按 numFailedTests / numFailedTestSuites / numRuntimeErrorTestSuites 判断，加单测 |
| P3 实跑：一次 `script` 录屏为空且退出码 1，无法复现 | 1 | 重跑正常；记录在案 |
| P2 提交 e7cf712 含一个失败的 jest 测试（fixture 加 `/* global */` 后行号 +1，复跑时只看了输出尾部） | 1 | P3 中修正；以后看测试结果必须看到 passed/failed 计数 |
| P1 子进程测试退出码 13（顶层 await 未完成）：client socket `unref()` 后 `close()` 等待期间事件循环为空 | 1 | `close()` 时 `socket.ref()`，冲刷完再放开 |
