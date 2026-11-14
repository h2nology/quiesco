# Progress: GitHub issues #1–#9

## Session 2026-11-14
- 新建计划 `.planning/2026-11-14-issues-0-2/`（PLAN_ID=2026-11-14-issues-0-2；`.active_plan` 已切到此计划）。
- `gh issue list` 读取 9 个 open issue（#1–#9，全部 2026-11-14 创建），全文要点写入 findings.md。
- 分成 6 个阶段：I.A CLI 小修（#7 #8）→ I.B 重置（#1 #9）→ I.C 诊断（#2 #3）→ I.D API（#4 #6）→ I.E 工作流（#5）→ I.F 验收发布。
- 待 HU 确认 D1–D6 后开始 I.A。尚未改代码。
- HU 决定：D1=a（agent 自动重置 expo-router）、D3 两者都做、D5=0.2.0、D6 按阶段一个 PR。D2、D4 未答，进入 I.B 前再问。

### I.A（#7 #8）
- 分支 `fix/cli-help-and-cucumber-paths`。改：`packages/cli/src/commands/test.ts`（TEST_HELP、`--` 分割）、`cli.ts`（HELP 提示）、`init.ts`（CUCUMBER_CONFIG 去 paths）、`examples/todo-app/cucumber.mjs`、docs en/ja/zh `cli.mdx`；测试 +2 个 / init 断言 +2。
- 实测 dry-run：修前单文件 86 场景 + 弃用警告；修后 5 场景、0 警告；`-- --tags` 过滤正常。
- `pnpm check` exit 0（679 tests）。`docs:check` 第一次失败：ja/zh 行内代码比 en 多一个 `--` ⇒ 改写译文措辞后通过。
- HU 决定：D2 按建议（默认初始路由 + 可选元素）；D4 默认开启，连续 3 次相同失败提前停止。

### I.B（#1 #9）进行中（2026-11-15）
- 分支 `fix/reset-navigation-state`（从 main 开；I.A 的计划文件改动通过 stash 带过来，stash pop 冲突后用 stash 版本解决）。
- agent：新增 `src/navigation/{index,expo-router}.ts`（NavigationReset：挂载时快照初始 root state，reset 时恢复；`routePath`；verify 以第一次 reset 后的路由为准）；QuiescoRoot 懒加载 expo-router 的 `useNavigationContainerRef`；ResetManager 新增 `navigation` 步骤（onReset 之后、remount 之前）；runtime 新增 `route` 方法、reset 结果带 `route`、路由不符抛 RESET_FAILED(step navigation)。
- protocol：`reset` 结果加 `route?`，新方法 `route`。core Driver：`currentRoute()`（不抛错）。
- 单元测试：agent 310 通过。
- 实测 web（scratchpad `ib/smoke`）：修前 1/4（34.7s）→ 修后 4/4（1.5s）。第一次实测失败：`t.resetRoot is not a function` ⇒ 改用 `current.resetRoot` 仍失败 ⇒ 查源码发现 expo-router 58 的容器根本没有 resetRoot ⇒ 改用 `reset(state)` 后通过。
- 注意：本分支的 `examples/todo-app/cucumber.mjs` 仍有 `paths`（I.A 未合并），指定单个 feature 会跑全套。
- 待做：iOS / Android 实测；D2 可选元素检查（host）；#9；文档；示例 App 的 soft-reset.feature 是否保留（它在示例里不能复现 #1，但作为回归仍有价值）。
- iOS（iPhone 17 / iOS 27.0，dev client + Metro）4/4、Android（API 37）4/4（复现 App，修后）。修前只在 web 上跑过（1/4）。
- D2：core `reset.expectVisible`（软 / 硬重置后都检查，失败 ⇒ RESET_FAILED step expectVisible，带当前路由）；连接类错误（RESTART_ON）不包装。
- #9：core `repeated-failures.ts`（签名 = 错误名 + 首行、数字归一；连续 N 次 ⇒ 提示一次 + 当前路由；`bailOnRepeatedFailure` 默认 3，false 只提示）；Lifecycle.before 在 bail 后返回 skipped，afterAll 打印跳过数；cucumber / jest / vitest 适配器传 error，jest 在 test_start 检查 bailedOut，vitest skip 原因用 bailedOut。
- 单元测试：core 249+、cucumber 16、jest 10、vitest 7 通过。
- 实测 web（复现 App 加「模块状态未清 ⇒ 挂载时跳到 /details」）：B/C/D 在 reset 即失败（路由信息清楚），第 3 次后打印提示（current route: /details）并跳过 E/F，总计 1.6s。
- 坑：npm 对同名同版本的 file: tarball 用缓存，重装不更新 ⇒ 直接把 tarball 解到 node_modules（注意保留包内嵌套 node_modules，如 core 的 ws）。

### I.C（#2 #3）进行中（2026-11-15）
- 分支 `fix/failure-diagnostics`，从 `fix/reset-navigation-state` 开（#2 复用 I.B 的 `route`）；PR base 设为 I.B 分支。
- #2 agent：`query/visibility.ts` 新增 `invisibleReason`（RNSScreen activityState<2 ⇒ 不在最上层的页面；自身 / 祖先 display:none 或 opacity:0；无法测量；0 尺寸；在窗口外；被 scroll / overflow 裁剪）；ELEMENT_NOT_FOUND 与 expect visible 的 ASSERTION_FAILED 消息带原因 + `(current route: …)`；「still busy」只在该次同步预算 ≥ min(250ms, timeout/4) 时附加（issue 里是 4ms）。
- #2 证据：protocol `listElements` + `ElementBrief`；agent `listElements`（有 testID / label / 自身文本的节点，含可见性、隐藏原因、rect，上限 500）；core 失败证据新增 `elements.json`（含 route）；旧 agent（-32601）不记为证据错误。
- #3：metro.cjs `watchMode`（export / export:embed / bundle ⇒ export；CI 为真 ⇒ CI）+ build-config 写 `bundle: { builtAt, watching, reason }`；agent 在 hello 里带 `bundle`；core `bundle-check.ts`（newestSource 跳过 node_modules / ios / android / dist / .expo 等，≤5000 文件；不监听且有更新的源文件 ⇒ 警告；CI 启动的 Metro 在 host 非 CI 时总是警告）；Session.adopt 每个 bundle 检查一次，debug 日志写 bundle 描述。doctor：交互终端里 CI 为真 ⇒ warn。
- 单元测试：agent 314、core 254、cli 24 通过；tsc -b 通过。
- 待做：smoke App 上实测（#2 三端消息、#3 CI=1 Metro + 改文件、web export 后改文件）；文档；pnpm check。

### I.B 回归修复（2026-11-15，在 I.B 分支上）
- I.C 实测示例 App iOS 全套时发现 I.B 让 3 个场景失败（main 上通过）：RESET 未被处理的 dev toast 盖住元素。原因与修法见 findings「I.B 回归」。
- 改 `packages/agent/src/navigation/index.ts`：快照存 partial；状态相同不 dispatch；越过 Expo Router 根包装层、以目标 navigator 当前完整 state + 初始 routes 作为 RESET payload，`target` 指定；restore 改 async，等 state 变化（≤1s）再 remount。runtime 传 sleep。
- 验证（I.B 分支）：3 个场景 iOS 通过；示例 App 全套 iOS 82 passed / 6 skipped、Android 83 / 5、web 75 / 13，无 RESET 警告；复现 App web / iOS / Android 均 4/4。pnpm check 699 通过。
- 未重跑：#9 的「模块状态导致跳走」实测（verify 逻辑未改，单元测试覆盖）。
- I.C（续）：示例 App 全套（I.C 代码）iOS 82 passed / 6 skipped、Android 83 / 5；`pnpm check` 709 通过；docs:check 通过。iOS 上发现被覆盖页面的元素被判为可见 ⇒ 新增 `screenNotOnTop`（RNSScreenStack 子顺序 + activityState 0）并纳入 visibleRatio。
