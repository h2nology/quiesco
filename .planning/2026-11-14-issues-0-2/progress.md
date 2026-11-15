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

### I.D（#4 #6）进行中（2026-11-15）
- 分支 `feat/go-back-typed-backdoors`，叠在 `fix/failure-diagnostics`（I.C）上。
- #4：protocol `goBack` action + host input；agent 先关键盘再交给 host（Android 首次返回只关键盘：示例 new-todo 自动聚焦，第一次实测失败于此）；Android = KEYCODE_BACK，web = page.goBack；iOS 经 XCUITest runner：新端点 `/navigationBar?bundleId=`（app 的导航栏与按钮）、`/edgeSwipeBack`；`backButton()` 选 `BackButton` id，否则左三分之一的可点按钮，内层（靠下）导航栏优先；无按钮则左边缘滑动。Driver.goBack：Expo Router 下路由未变 ⇒ ASSERTION_FAILED。steps 包新增 `goBack`（返回上一页 / 前の画面に戻る / I go back）；iOS pressBack 的提示改为指向 goBack。
- 实测：示例 App 新增 `features/go-back.feature`（REQ-DEMO-011，新建待办页返回、gestureEnabled:false 的能力演示页返回）web / iOS / Android 均 2/2（iOS runner 因源码变化自动重建）；smoke App `headerShown:false` 页 iOS 左边缘滑动返回 1/1。
- 文档 en/ja/zh：api.mdx、platforms.mdx、steps.mdx、steps README。
- #6：protocol `JsonCompatible` / `Backdoors` / `BackdoorName` / `BackdoorParams` / `BackdoorResult` / `BackdoorImpl`；先在 scratchpad 用 tsc 验证「对再导出的 interface 做 module augmentation 会合并到原声明、两个再导出模块共用」；Driver.backdoor 两个重载（注册表 / JSON 兼容）；agent `quiesco.backdoor<K extends BackdoorName>(name, fn: BackdoorImpl<K>)`；示例 App 声明全部后门、generic 步骤的动态名称改为 `as keyof Backdoors`；core 启用 typecheck；文档改为独立 `### 类型化后门` 小节。pnpm check 718 通过。

### I.E（#5）进行中（2026-11-15）
- 分支 `feat/metro-and-build`，叠在 I.D 上。
- 设计：Metro 管理放在 `quiesco test`（CLI 主进程，一次运行只一个；并行 worker 不会各自启停）；直接跑 cucumber-js 不启动（文档写明）。
- cli：`dev-server.ts`（devServerUrl：devClient.metroUrl 默认 :8081 / apps.web.url；`/status` 判断运行；未运行且是本机 ⇒ `npx expo start --port {port}` + EXPO_PUBLIC_QUIESCO=1，日志 `artifacts/metro.log`，500ms 轮询，超时 / 提前退出报错带日志尾；结束或 Ctrl-C 停进程组）；context 新增 spawnBackground / httpGet / onInterrupt / sleep；core config `devServer { autoStart, command, timeoutMs }`。
- cli：`commands/build.ts`：prebuild（EXPO_PUBLIC_QUIESCO=1）+ iOS xcodebuild（derivedData / configuration / scheme 从 binaryPath 解析，-quiet）/ Android gradlew assemble<Variant>（必要时复制到 binaryPath）；原生输入指纹（app 配置 + 依赖及已安装版本）存 `.expo/quiesco/build-<platform>.json`，Debug 未变且产物在 ⇒ 跳过；Release 总是构建；`--force`。项目里没有 @expo/fingerprint，所以自己算。init 的配置注释、脚本（e2e:build:ios / e2e:build:android）、下一步说明改为 quiesco build。
- 单元测试：cli 34 通过。
- 实测：示例 App Metro 未运行时 `quiesco test --platform ios` ⇒ 自动启动、1 场景通过、结束后 8082 无监听；进程组 SIGINT ⇒ exit 130、Metro 停止；smoke `quiesco build ios` 成功（产物 08:41 更新），再次运行 0.1s 跳过；用新构建 + 自动 Metro 跑 iOS 1/1。Android build 进行中。
- 文档：en/ja/zh native.mdx、cli.mdx（quiesco build 小节、Metro 说明）、api.mdx 配置表 devServer；README 原生部分。
- Android：`quiesco build android` 成功（2m47s）、重跑跳过；新 APK + 自动 Metro 跑 Android 1/1。pnpm check 728 通过（第一次 lint 失败：build.test.ts 的 let ⇒ const）。

### I.F 验收进行中（2026-11-15）
- PR #10–#14 都还没 merge ⇒ 本地集成分支 `integration/0.2.0`（不 push）：feat/metro-and-build + merge fix/cli-help-and-cucumber-paths（test.ts 冲突：合并 `--` / --help 与 TestDeps / Metro；help 补 Metro 自动启动说明）。
- `pnpm release:check` 通过（730 测试）；docs:check 通过。版本号改为 0.2.0（工作区，未提交），打 11 个 tarball 到 scratchpad `if/tgz`。
- 全新 create-expo-app（SDK 58.0.25 / expo-router 58.0.31 / RN 0.88.1）`if/repro`，`init --packages`；复现 App 按 issue：`QuiescoRoot > Stack`，index（home / search / add-student / 学生列表）、`/students/new`（表单校验）、typed backdoors（students.set/get、debug.stick 模块状态）。
- Web：students.feature 4/4（#1 A 停子页后 B 从首页开始、#4 goBack、#6 typed backdoor）；只跑指定文件、无 deprecation（#8）；`--help` / `-- --name`（#7）；diag.feature 消息带原因 + current route、elements.json（#2）；stuck.feature 3 次 RESET_FAILED 后提示并跳过 2 个，1.4s（#9）；一次性 export 后改 src ⇒ 警告（#3）。
- 发现并修：① #3 改 step 文件也报 stale（扫描含 features/）⇒ 跳过测试目录 / 测试文件 / 根目录工具配置，+1 单元测试，文档 en/ja/zh troubleshooting（commit 2f22416）；② 测试端 `import '../../src/backdoors'` 在 Node 下运行失败 ⇒ 文档 api.mdx 写明用 `import type {}`；③ doctor「app build not found」提示改为 `npx quiesco build ios|android`（未提交）。
- 坑：复现 App 用 useSyncExternalStore 未传 getServerSnapshot ⇒ web server 输出下 SSR 失败、客户端报 React #419（0.1.1 同样）⇒ App 自身问题。
- 回复草稿：replies.md。
- 进行中：`quiesco build ios`。
- `quiesco build ios` 成功（无 expo-dev-client 也可），重跑 0.3s 跳过；`quiesco build android` 成功，重跑跳过。
- iOS（iPhone 17 / iOS 27.0）：Metro 自动启动 → students 4/4（goBack 点原生导航栏返回）→ 结束后 8081 无监听；diag：#2「on a screen that is not on top … (current route: /students/new)」、#9 3 次 RESET_FAILED 后跳过 2 个；`CI=1` 手动启动的 Metro ⇒ 复用 + 「Metro was started with CI set」警告（#3）。
- 坑：iOS 26+ 原生导航栏透明，复现 App 的 View 内容画在导航栏下 ⇒ tap 报「covered by … NavigationBarContentView」（判断正确，App 布局问题）⇒ ScrollView contentInsetAdjustmentBehavior="automatic"。
- Android（API 37）：Metro 自动启动 → students 4/4；diag 同 iOS（#2、#9）。
- 集成分支 `pnpm check` 731 通过；示例 App web 全套 77 passed / 13 skipped（之前 75 + go-back 2）。
- 验收完成，等 HU（见 task_plan Next Step）。
- merge #10–#14（merge commit；#11 计划文件冲突、#14 test.ts 冲突按集成分支解决；每步 pnpm check：701 / 711 / 720 / 731）；main 上 `chore(release): 0.2.0`（148b77c），release:check 通过。
- npm publish：本机 pnpm 非交互无法过 2FA ⇒ HU 自己发布；刚发布时 registry 处于 validating，几分钟后 11 包均为 0.2.0（latest）。tag v0.2.0 已 push；9 个 issue 已贴回复（replies.md）。I.F 完成。
