# Task Plan: 测试进度条 + Quiesco UI

## Goal
1. `quiesco test` 运行时在终端底部常驻一个进度条（总数、已完成、通过 / 失败 / 跳过、当前测试）。
2. 仿照 Vitest UI 新增 `quiesco ui`：浏览器里看到测试树，点击运行全部 / 某个文件 / 某个测试，实时看到已完成的测试、
   进度条、失败信息和 Quiesco 证据（截图、元素树、空闲状态、日志）。
3. cucumber / vitest / jest 三个 runner 全部支持；附测试、三语文档，在 examples/todo-app 上实跑验收。

## Current Phase
P0

## Next Step
P0：逐个查证三个 runner 的 reporter / formatter API 与「列出测试」能力（写进 findings.md），确认事件协议可行后再动代码。

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
- [ ] cucumber-js：自定义 formatter 拿 `testCase` / `testCaseStarted` / `testCaseFinished` 消息；`--parallel` 下 formatter 是否只在主进程；与用户自己的 `--format` 并存方式；`--dry-run` 列出 pickle（id、名字、feature:行号）
- [ ] Vitest 5：reporter API（收集完成时拿总数、单测试开始/结束）；`--reporter` 追加而不替换默认 reporter 的写法；`vitest list --json`
- [ ] Jest：自定义 reporter（`onRunStart` / `onTestCaseStart` / `onTestCaseResult`）；`--reporters default --reporters X`；测试名的列出能力（`--listTests` 只有文件）
- [ ] Vitest UI 功能清单（以实际 `@vitest/ui` 为准），决定第一版要做 / 不做的项
- [ ] 过滤运行单个测试的参数：cucumber `path:line` / `--name`，vitest `file -t`，jest `file -t`（名字含正则字符时的转义）
- [ ] IPC 选型：Unix socket / Windows named pipe vs. 本地 TCP vs. 写文件；结论记 findings
**Status:** in_progress

### P1 事件协议与传输
- [ ] 定义事件类型（TS 类型 + 版本号字段），NDJSON 编解码，单元测试
- [ ] 传输：服务端（CLI 侧）监听 + 客户端（reporter 侧）连接；`QUIESCO_EVENTS` 不存在时 reporter 什么都不做
- [ ] depcruise 规则：协议模块不依赖任何 runner
**Status:** pending

### P2 三个 runner 的 reporter
- [ ] `@quiesco/cucumber` formatter（含 `--parallel`、Scenario Outline 每行一个测试、hook 失败）
- [ ] `@quiesco/vitest` reporter（含 skip、tag 跳过、worker 编号）
- [ ] `@quiesco/jest` reporter（总数在收集后更新）
- [ ] `quiesco test` 自动注入 reporter，不覆盖用户自己的 reporter / format 配置
- [ ] 失败证据路径进入 `testEnd`
**Status:** pending

### P3 终端进度条
- [ ] runner stdout/stderr 改为管道转发，底部一行重绘（宽度自适应、ANSI 处理、换行不撕裂）
- [ ] 显示：`[████░░░░] 12/30  ✓10 ✗1 ↷1  2m13s  ▶ 当前测试名`；多 worker 时显示各 worker 当前测试
- [ ] 总数未知时（jest 收集前）显示不确定态
- [ ] 非 TTY、`CI=true`、`--no-progress` 时关闭并保持原样 stdio；退出码不变；Ctrl-C 正确传给 runner
- [ ] 单元测试（渲染器纯函数化，喂事件断言输出）
**Status:** pending

### P4 测试发现（UI 用）
- [ ] 统一的 `listTests(runner)` → 文件 / 分组 / 测试树（cucumber dry-run，vitest list，jest 方案按 P0 结论）
- [ ] 文件变化后重新发现（watch features / 测试文件）
**Status:** pending

### P5 UI 服务 `quiesco ui`
- [ ] 命令：`quiesco ui --platform … [--runner …] [--port] [--open]`；只监听 127.0.0.1
- [ ] 常驻 Metro（复用 `ensureDevServer`），退出时清理
- [ ] HTTP 静态资源 + WebSocket；命令：list / run(全部|文件|测试 ids) / cancel；事件转发
- [ ] 运行队列：同一时间只跑一次（一个 session / 设备），运行中点击给出提示或排队
- [ ] 证据文件接口（限制在 artifacts 目录，防路径穿越）
- [ ] UI 打包位置：新包 `@quiesco/ui`（CLI 动态加载，未安装时提示安装）—— 待 P0 后与 HU 确认
**Status:** pending

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

## 待用户确认（P0 之后）
- UI 是否独立成 `@quiesco/ui` 包（推荐，避免 CLI 带上 React 构建产物和 `ws` 依赖）
- 版本号：随下一个版本 0.3.0 发布？
- 第一版 UI 不做的项（候选：源码查看、模块图、覆盖率、watch 自动重跑）

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
