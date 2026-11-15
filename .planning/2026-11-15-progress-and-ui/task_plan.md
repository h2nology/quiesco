# Task Plan: 测试进度条 + Quiesco UI

## Goal
1. `quiesco test` 运行时在终端底部常驻一个进度条（总数、已完成、通过 / 失败 / 跳过、当前测试）。
2. 仿照 Vitest UI 新增 `quiesco ui`：浏览器里看到测试树，点击运行全部 / 某个文件 / 某个测试，实时看到已完成的测试、
   进度条、失败信息和 Quiesco 证据（截图、元素树、空闲状态、日志）。
3. cucumber / vitest / jest 三个 runner 全部支持；附测试、三语文档，在 examples/todo-app 上实跑验收。

## Current Phase
P5

## Next Step
P5 开始前先做 P6 的第一步「设计先行」（ui-ux-pro-max）给 HU 确认，因为 UI 服务的 WebSocket 消息形状取决于界面要显示什么；然后建 `@quiesco/ui` 包（服务端：HTTP + WebSocket + 运行队列 + 证据文件接口）。

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
- [ ] 命令：`quiesco ui --platform … [--runner …] [--port] [--open]`；只监听 127.0.0.1
- [ ] 常驻 Metro（复用 `ensureDevServer`），退出时清理
- [ ] HTTP 静态资源 + WebSocket；命令：list / run(全部|文件|测试 ids) / cancel；事件转发
- [ ] 运行队列：同一时间只跑一次（一个 session / 设备），运行中点击给出提示或排队
- [ ] 证据文件接口（限制在 artifacts 目录，防路径穿越）
- [ ] 新包 `@quiesco/ui`：`quiesco ui` 动态加载，未安装时提示 `npm i -D @quiesco/ui`
- [ ] 测试树：启动时 `listTests()`，测试文件变化时重新列出；运行结果按 id 合并（Vitest `.each` 静态项在该文件跑过后由真实结果替换）
- [ ] 运行选中项：cucumber `path:line`（配置有 `paths` 时的处理）、vitest `file:line`（`.each` 单例加 `-t`）、jest `--runTestsByPath file -t '^…$'`
**Status:** in_progress

### P6 UI 前端（React + Vite）
- [ ] **设计先行**：用 `ui-ux-pro-max` 插件（skill `ui-ux-pro-max:ui-ux-pro-max`，必要时配合 `ui-ux-pro-max:design-system` 定 token）
      做 UI/UX 设计：信息架构、布局、配色（亮 / 暗主题）、字体、状态色（通过 / 失败 / 跳过 / 运行中）、图标、交互与无障碍；
      产出设计说明写进 findings.md，并给 HU 确认后再实现
- [ ] 按设计实现（React + Vite stack 规范以 ui-ux-pro-max 的建议为准），实现后用该插件做一次 UI 审查
- [ ] 左侧测试树：状态图标、搜索 / 过滤（失败、tag）、运行按钮（全部 / 文件 / 单个）
- [ ] 顶部进度条与计数，运行 / 取消
- [ ] 右侧详情：错误信息与堆栈、cucumber 步骤、耗时、证据（截图、元素树、空闲状态、日志）
- [ ] 断线重连；运行中刷新页面能恢复当前状态
- [ ] 组件测试 + 一个 Playwright 端到端冒烟（打开 UI、点运行、看到结果）
**Status:** pending

### P7 文档与验收
- [ ] 三语文档：`cli.mdx`（`--no-progress`、`quiesco ui`），新增 UI 页面；README 提及
- [ ] examples/todo-app：web 三个 runner 各跑一次进度条；UI 中点击运行单个测试 / 文件 / 全部；iOS、Android 至少各一次
- [ ] `pnpm check` 全绿；`check:prod-strip` 不受影响
**Status:** pending

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
