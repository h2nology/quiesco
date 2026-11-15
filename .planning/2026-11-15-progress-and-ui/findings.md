# Findings: 进度条 + 测试 UI

## 现状（2026-11-15 调研）

### `quiesco test` 的执行方式
- `packages/cli/src/commands/test.ts`：解析 `--platform / --runner / --workers`，按需启动 Metro（`ensureDevServer`），
  然后 `ctx.run('npx', [runner, ...args])` 把整个运行交给 runner 子进程（stdio 继承）。
- CLI 本身**拿不到任何测试事件**：不知道总数、不知道每个测试的开始 / 结束。
- 三个 runner：`cucumber`（cucumber-js，`--parallel N`）、`jest`（`--maxWorkers N`）、`vitest run`（`--maxWorkers N`）。

### 运行器适配层（各自挂在 core `Lifecycle` 上）
- core `Lifecycle`（`packages/core/src/lifecycle.ts`）：`beforeAll / before(tags, name) / after(result) / afterAll`，
  与 runner 无关；**只知道单个测试的开始和结束，不知道总数**，也看不到被 runner 过滤 / 跳过的测试。
- cucumber：`register-hooks.ts` 用 BeforeAll/Before/After/AfterAll 钩子。总数要靠 cucumber 的 message 流
  （`testRunStarted` / `testCase` / `testCaseStarted` / `testCaseFinished`），即**自定义 formatter**。
- vitest：`index.ts` 用 fixture。总数与实时状态要靠 **Vitest reporter API**（`onTestModuleCollected`、
  `onTestCaseResult` 等，Vitest 5）。
- jest：`events.ts` 用 jest-circus 事件（在测试环境里）。总数要靠 **Jest reporter**（`onRunStart(aggregatedResults)`
  的 `numTotalTestSuites`；测试级用 `onTestCaseResult`）。注意 Jest 只能在跑之前知道文件数，测试数要收集后才知道。

### 结论：事件来源
- 进度条需要「总数」→ 必须在每个 runner 的 reporter / formatter 层拿事件，core Lifecycle 不够。
- 可行架构：每个适配器包提供一个 reporter / formatter，把事件统一成 Quiesco 自己的事件协议
  （NDJSON），写到 CLI 通过环境变量给出的通道（例如 `QUIESCO_EVENTS=<socket 或 fd>`）；CLI 侧消费事件，
  画终端进度条、或推给 UI。
- 多 worker：cucumber `--parallel` 的 formatter 只在主进程，天然汇总；vitest / jest reporter 也在主进程。好。

### 仓库约束
- monorepo，pnpm，TypeScript 6，Node ≥ 24，vitest 5；`.dependency-cruiser.cjs` 约束包间依赖（core 不依赖 runner）。
- 文档在 `docs/`（en + ja + zh 三语 mdx）；`pnpm check` = build + lint + depcruise + test + example typecheck。
- 示例 App：`examples/todo-app`（三端可跑，用于实跑验收）。

## Vitest UI 参考（待查证）
- `@vitest/ui`：`vitest --ui` 起一个本地 Web 服务，左侧文件 / 测试树，点运行某个测试，实时状态、耗时、错误、
  模块图、源码；通过 WebSocket（birpc）与 Vitest 进程通信。
- Quiesco 版需要额外考虑：一次只能有一个 session（设备）；运行中再点「运行」要排队或拒绝；
  失败的证据（截图、元素树、空闲状态、日志）可以直接在 UI 里展示 —— 这是比 vitest UI 更有价值的部分。

## 开放问题
见 task_plan.md「待用户确认」。
