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

## P0 查证：IPC 选型（2026-11-15，实验于 scratchpad/ipc-probe）
- 安装版本（根目录 hoisted node_modules）：@cucumber/cucumber 13.3.0、jest 30.5.2、@jest/reporters 30.5.2、vitest 5.1.0；
  `ws` 8.22.1 已是 core / web 的依赖（`packages/core/src/server/ws-server.ts`）。@vitest/ui 未安装。
- CLI 用 `ctx.run('npx', …, stdio: 'inherit', shell: isWindows)` 起 runner（`packages/cli/src/context.ts:66`）。
- **额外 fd（fd3 管道）不可行**：经过 `npx` 后子进程 `fs.writeSync(3)` 报 `ENXIO`，fd 没有传下去。
- **Unix domain socket（Windows 用 named pipe）可行**：`node:net` 零依赖；macOS `os.tmpdir()` 下路径 74 字节
  （上限 104），5000 条 NDJSON 事件经 `npx node` 子进程发回约 0.46 s。环境变量正常透传。
- 本地 TCP（127.0.0.1:0）也可行但端口对本机其他用户可见，需要 token；不如 socket 文件（权限随用户）。
- 写 NDJSON 文件 + 轮询：延迟高、要处理截断，不选。
- **结论**：`QUIESCO_EVENTS=<socket 路径 | \\.\pipe\quiesco-…>`，reporter 用 `net.createConnection` 写 NDJSON；
  变量不存在 → reporter 什么都不做（用户直接跑 `cucumber-js` 时零影响）。连接失败只警告一次，不让测试失败。
- 包归属倾向：事件**类型**放 `@quiesco/protocol`（叶子包，depcruise `protocol-is-leaf` 允许），
  客户端 / 服务端传输放 `@quiesco/core`（适配器包已依赖 core；CLI 也依赖 core）。

## P0 查证：Jest 30.5.2（子 agent 实验于 scratchpad/jest-probe）
- **reporter 钩子全部存在且被 await**：`onRunStart`、`onTestFileStart`、`onTestCaseStart`、`onTestCaseResult`、
  `onTestFileResult`、`onRunComplete`（`@jest/core/build/index.js` ~255–320）。`onTestStart/onTestResult` 是旧接口，新钩子存在时不调用。
- **总数**：`onRunStart` 只有文件数（`numTotalTestSuites`），`numTotalTests=0`；测试数按文件逐步得知（`onTestFileResult` 的 agg 递增）。
  → 进度条总数「随文件增长」，或用 P4 的发现结果作初值。
- **实时**：多 worker 下 `onTestCaseStart/Result` 实时到达主进程（worker → `messageParent` → `UNSTABLE_onCustomMessage`）；
  **没有 worker id**。`-i` 同样触发；快速套件 Jest 会自己转 in-band。
- `onTestCaseStart` info：`{ancestorTitles, fullName, title, startedAt}`，文件取 `test.path`；
  `onTestCaseResult`：status / duration / failureMessages / failureDetails / location（需 `--testLocationInResults`，`test.each` 各行共用一个位置）。
- **缺口（必须在 `onTestFileResult` 里补）**：skip（含 `-t` 不匹配、Quiesco 平台跳过 `mode='skip'`）**没有任何 case 事件**，只在文件结果里是 `pending`；
  todo 只有结果没有开始；收集阶段抛错 / 语法错的文件只有 `testExecError`、0 个测试。
- **测试 id**：`file + \0 + ancestorTitles.concat(title).join(\0)`（`fullName` 不唯一）。
- **注入 reporter**：CLI `--reporters` **整体替换**配置里的 reporters（`jest-config` setFromArgv ~2648）；preset 的 reporters 也会被用户配置整体覆盖。
  CLI 选项只能传字符串（不能带 options 元组）；`--reporters` 是 yargs 数组，会吞掉后面的位置参数（路径要放前面或 `--` 之后）。
  未配置 reporters 时 Jest 在检测到 AI agent 时用 `agent` 而不是 `default`。
  → **推荐**：在 `@quiesco/jest` preset 里放 `reporters: ['default', <quiesco reporter>]`，`QUIESCO_EVENTS` 未设置时 no-op；
  自定义了 reporters 的用户自己加 `'@quiesco/jest/reporter'`（文档写明，需 exports 条目）；CLI 在 N 秒内没收到 run-start 时提示。CLI 不注入 `--reporters`。
- **列出测试名**：`--listTests` 只有文件。可用的 collect-only：`--testLocationInResults --testNamePattern='(?!)' --reporters=<list>`，
  全部测试以 pending 报出（含 ancestorTitles / location，`test.each` 展开），钩子不跑，5 个文件 0.6 s。
  **但 test environment `setup()` 仍会运行（Quiesco 的 `startShared` 会启动设备）**，用户 globalSetup（todo-app 的 mock 后端）也会跑。
  → 需要 Quiesco 环境在 `QUIESCO_LIST=1` 时跳过 `startShared`，并用空的 `--globalSetup/--globalTeardown` 覆盖；todo 会显示成 pending。
  → **UI 树推荐**：先用 `--listTests` 显示文件，后台 collect-only 补测试并按 mtime 缓存，每次运行后用真实结果刷新。
- **单测运行**：`-t` = `new RegExp(p, 'i')`（**不区分大小写**），匹配「祖先标题 + 标题」以单空格拼接。转义正则字符并 `^…$` 锚定，已验证；
  多个测试 `^(a|b|c)$`；整个 describe 用前缀 `^outer inner `；限定文件用 `--runTestsByPath`。
  注意：模式是全局的（别的被选文件里同名测试也会跑）；空格拼接有歧义；大小写冲突。未选中的测试在结果里是 pending。
- **用 jest-circus 环境直接发事件**：能拿到 `JEST_WORKER_ID`、完整树、显式 skip/todo、证据文件；但没有 run 级事件，
  收集前就失败的文件、worker 崩溃 / 超时都看不到，失败信息不是 Jest 最终格式。
  → **推荐**：reporter 为主；环境可选地往同一 socket 补 worker id 与证据（按 file + 测试路径关联）。

## P0 查证：cucumber-js 13.3.0（子 agent 实验于 scratchpad/cucumber-probe，12.x 对比读 scratchpad/v12pkg）
- **API**：用 formatter plugin `{ type: 'formatter', optionsKey: 'quiesco', formatter({ on, options, write, … }) }`
  （`lib/plugin/types.d.ts`，`lib/formatter/find_class_or_plugin.js`）；返回的 cleanup Promise 会被 await。12.0 起就有（12.0 的 ctx 无 `stream`）。
  `--plugin` 12.5 才有，且与配置按数组下标合并（覆盖），**不用**。
- **消息顺序**：meta → source/gherkinDocument/pickle… → hook/stepDefinition → testRunStarted → BeforeAll → **N × testCase** →
  每个测试 testCaseStarted → testStep* → testCaseFinished → testRunFinished。
- **总数** = 第一个 testCaseStarted 之前的 `testCase` 个数（串行、并行都成立）。**不能数 `pickle`**（过滤前的全部场景）。
  BeforeAll 失败 → 0 个 testCase，错误只在 `testRunHookFinished.result` → formatter 要转发它。
- testCaseStarted `{id, testCaseId, attempt, timestamp, workerId?}` → testCase.pickleId → pickle `{name, uri, location.line, tags}`。
  testCaseFinished **没有 status**：取该 testCaseStartedId 下最严重的 testStepFinished 结果
  （UNKNOWN<PASSED<SKIPPED<PENDING<UNDEFINED<AMBIGUOUS<FAILED），错误在 `message` / `exception`；时长 = 时间戳差。可用 `@cucumber/query`。
- Scenario Outline 每行一个 testCase（名字已插值、line 是行号、继承 Examples 标签）。`--retry`：同 testCaseId 再次开始、`attempt+1`，
  前一次 `willBeRetried: true` → **只在 `willBeRetried === false` 时计数**。
- **id 每次运行都是新 UUID → 测试用 `uri:line` 标识**。
- `--parallel`：formatter 只在协调进程，收齐所有 worker 消息；`workerId` "0"/"1"（串行时无）。
  13.x worker 是 `worker_threads`（同一 pid），12.x 是 `child_process.fork`；`CUCUMBER_WORKER_ID` 环境变量两者都有。
- **注入方式**：`format` 是追加的，但**只能有一个 stdout formatter**（无目标的最后一个胜出）→ 我们的 format **必须带文件目标**：
  `--format "\"file:///abs/events.mjs\":\"/dev/null\""` + `--format-options '{"quiesco":{"socket":"…"}}'`（formatOptions 深合并）。
  Windows 用临时文件代替 `/dev/null`。裸包名只在 hoisted 安装时能解析 → 用 `file://` 绝对 URL。已验证用户的 progress 输出和 json 文件不受影响。
- **列出测试**：`cucumber-js --dry-run` 会**同时运行用户配置的 formats（会覆盖他们的报告文件）**，且 support 文件顶层代码会执行。
  → **推荐编程 API**：`loadConfiguration` + `runCucumber({... dryRun: true, parallel: 0, formats 换成空, plugins 清空 })`，
  收集被 testCase 引用的 pickle（todo-app 90 个场景，探针集约 25 ms）。更便宜的 `loadSources` 不加载 support 代码但没有 tags/id。
  ⚠️ 探针期间在 todo-app 跑过一次 `--dry-run`，覆盖了 gitignore 的 `examples/todo-app/reports/cucumber.html`（无 git 影响）。
- **单测运行**：`path:line`（Scenario 行 = 该场景或整个 Outline；Examples 行 = 该行；多行 `a.feature:3:16`；多个参数 OR）。
  `--name` 是未锚定正则、可重复（OR），需转义 + `^…$`。
  ⚠️ **CLI 路径会追加到配置的 `paths` 上而不是替换**（有弃用警告）：配置里有 `paths` 时，要么生成一个去掉 `paths` 的 `--config` 包装，要么走 API。
- `--fail-fast`（串行）：剩余测试仍发开始/结束事件，状态 skipped。run:end 时把没结束的测试标为「未运行」。

## P0 查证：Vitest 5.1.0（子 agent 实验于 scratchpad/vitest-probe、vitest-probe2、ui-pkg）
- **钩子顺序**（`vitest/dist/chunks/plugin.d.LRFSN46m.d.ts:2237-2314`）：onInit → onTestRunStart(specs=文件) → 每个文件
  onTestModuleQueued → onTestModuleCollected（该文件完整树）→ onTestModuleStart → onTestCaseReady / onTestCaseResult … →
  onTestModuleEnd → onTestRunEnd(modules, unhandledErrors, reason: passed|failed|interrupted)。旧的 onCollected/onFinished 不调用。
- **总数**：串行时下一个文件要等上一个跑完才收集 → 真实总数最后才知道。
  **提前估算**：onInit 存 `vitest`，onTestRunStart 里 `await vitest.parseSpecifications(specs)`（静态解析、不执行，3–4 ms，遵守 `-t`）。
  `test.each` 不展开（算 1 个）→ 先发估算，每个文件 onTestModuleCollected 时用真实数替换。
- **单测事件**：Ready = 开始，Result = 结束；`result()` {state, errors{name,message,stack,diff,expected,actual}, note}；
  `diagnostic()` {duration, startTime, retryCount, flaky, slow}；`t.logs()` 是该测试的 console 输出。skip / todo 也有 Ready+Result。
  ⚠️ worker 事件节流 100 ms（`throttle(sendTasksUpdate, 100)`）：快测试 Ready 与 Result 同时到 → 计时用 `startTime`，不用到达时间。
- **映射**：`id` 由文件 hash + 索引路径生成，跨运行稳定（`.each` 及其后兄弟除外）；`fullName` 用 ` > ` 拼接；文件 `module.moduleId`；
  `location` 需 `includeTaskLocation`（→ `quiesco()` 里打开）。
- **多 worker**：钩子都在主进程。worker 槽位 = `testCase.module.diagnostic().concurrencyId`（1..N，等于 VITEST_POOL_ID）；`workerId` 每文件递增，不可用。
- **注入 reporter**：CLI `--reporter` **完全替换**配置 reporters（`--reporter default --reporter x` 也丢掉用户的）。
  **插件可行**：`configureVitest({ vitest })` 在 createReporters 之前执行，`vitest.config.reporters.push([...])` 保留全部（含用户的 `--reporter verbose`）。
  `quiesco()` 现在只返回 `test` 选项 → 需新增插件导出让用户放进 `plugins`，或 CLI 生成 `mergeConfig` 包装配置。包名 specifier 可解析（项目根）。
  → **推荐**：插件 + 环境变量门控；无插件时仅在用户没配 reporters 时回退到 CLI `--reporter default --reporter @quiesco/vitest/reporter`。
- **列出测试**：`vitest list --json` v5 默认静态解析（0.36 s），**不跑** globalSetup / setupFiles / 模块代码 / fixture；
  输出 `[{name: 全名, file, location}]`；`.each` 不展开；**skip / todo 被省略**；带引号的名字会被二次转义（→ 用 file+line 匹配）。
  需要配置声明 `tags`（`quiesco()` 已声明）。**禁止 `--staticParse=false`**（会跑 globalSetup → todo-app 的 mock 服务）。也可进程内 `parseSpecifications`。
- **单测运行**：`vitest run file:line …` 支持（行可以是 test 或 describe；多个可跨文件；`.each` 行跑全部；无测试的行报错）。
  `-t` 匹配 ` > ` 全名的正则，需转义 + `^…$`；只有 `-t` 能挑 `.each` 的某一个。**不带文件只用 `-t` 会 import 所有文件** → 始终带文件。
  CLI 没有按 id 运行（只有 Node API）。→ UI 用 `file:line`，`.each` 单例再加 `-t`。
- ⚠️ 探针首轮用 symlink 的 node_modules，vitest 往仓库 node_modules 写了缓存；agent 已按时间戳删掉自己产生的缓存，git 状态干净（已复查）。

## Vitest UI（@vitest/ui 5.1.0）功能清单（文档 + 解包 tarball，未装进仓库）
- 架构：`vitest --ui`（watch 模式）在 51204 端口服务 `/__vitest__/`，token 保护（页面注入 / cookie / `?token=`），
  WebSocket `/__vitest_api__` + birpc + flatted；执行需 `api.allowExec`；客户端约 816 KB（含 CodeMirror）。
- 功能：
  1. 布局：左导航、中间文件详情、可隐藏的底部 / 右侧面板，连接状态遮罩（Connecting / Disconnected）
  2. 仪表盘：文件与测试计数（pass/fail/skip/todo/slow）、总耗时、未处理错误
  3. 测试树：文件 → suite → test，状态图标、耗时、全部展开 / 折叠
  4. 搜索（名字、`tag:` 表达式）
  5. 过滤：Pass / Fail / Skip / Todo / Slow / Only Tests / project
  6. 排序：默认 / 最慢 / 最快 / project
  7. 运行：全部重跑、重跑过滤结果、当前文件、当前 suite、当前测试、修复快照
  8. 文件详情标签页：Report（错误 + 堆栈 + diff、附件、失败截图）、Console（每个测试的 stdout/stderr）、
     Code（CodeMirror 可编辑保存、高亮错误行、在编辑器中打开）、Module Graph
  9. Trace Viewer（仅 browser mode）　10. 覆盖率报告嵌入　11. 报告模式（`--reporter=html` 生成静态只读 UI）
- agent 建议的 Quiesco 第一版子集：1、2、3、4、5、7（全部 / 文件 / suite / 测试，无快照）、8（Report、Console、只读 Code），
  加「设备 / worker 泳道」；Quiesco 证据（截图、元素树、空闲状态、日志）放在 Trace Viewer 的位置。不需要 Vitest 的 watch API。

## P0 汇总：三个 runner 对照
| | cucumber 13 | vitest 5 | jest 30 |
|---|---|---|---|
| 事件来源 | formatter plugin（协调进程） | reporter（主进程） | reporter（主进程） |
| 注入方式 | CLI `--format "file://…":"/dev/null"` + `--format-options`（追加，不破坏用户） | `configureVitest` 插件 push reporter；回退 CLI 仅限无用户 reporters | preset 里 `reporters: ['default', quiesco]`；用户自定义时自己加；CLI 不注入 |
| 总数 | 首个 testCaseStarted 前的 testCase 数（准确） | parseSpecifications 估算 → 每文件收集后修正 | 只知文件数 → 每文件结束后累加（或用发现结果作初值） |
| skip / todo | 有事件 | 有事件 | **无 case 事件**，需从 onTestFileResult 补 |
| worker 标识 | `workerId` | `concurrencyId` | 无（环境里有 JEST_WORKER_ID，可选补发） |
| 稳定测试 id | `uri:line` | vitest `id`（或 file+line） | file + 祖先标题 + 标题 |
| 列出测试 | 编程 API dry-run（清空 formats/plugins） | `vitest list --json`（静态） | collect-only（`-t '(?!)'`）+ 环境跳过设备 + 空 globalSetup；先显示文件 |
| 单测运行 | `path:line`（注意配置 `paths` 会追加） | `file:line`，`.each` 加 `-t` | `--runTestsByPath file -t '^…$'`（不区分大小写、全局） |

### 事件协议草案（v1，NDJSON）
- `hello {protocol: 1, runner, version}`：CLI 据此判断 reporter 已接入（Jest / Vitest 用户自定义配置时未接入要提示）
- `run:start {total, totalIsEstimate, files[]}`、`total:update {total, totalIsEstimate}`
- `file:start {file}`、`file:end {file, error?}`（收集失败 / 语法错 / BeforeAll 失败都走 `error`）
- `test:start {id, file, line?, name, fullName, worker?, attempt}`
- `test:end {id, status: passed|failed|skipped|todo|pending|undefined, durationMs, error?{message, stack, diff?}, willRetry, evidence[]?}`
- `run:end {success, reason?, counts}`；CLI 把 run:end 时仍未结束的测试标为「未运行」
- 证据路径：core `Lifecycle.after()` 产生的文件 → 由各适配器的 hook/fixture 侧单独发 `test:evidence {id, files[]}`（reporter 拿不到 Lifecycle），按 id 关联

## 开放问题
见 task_plan.md「待用户确认」。
