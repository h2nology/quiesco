# Progress Log

## Session 1 — 2026-11-07
- 通读 `requirements.md`。
- 用 planning-with-files 初始化命名计划 `.planning/2026-11-07-quiesco/`（按 HU 要求不放根目录）。
- 将 requirements.md 第 10 节的 6 个阶段（Phase 0〜5）写入 task_plan.md，Phase 0 细化为 0.0 环境盘点、0.1 spike App、S1〜S7、0.9 汇总。
- 列出 §11 待 HU 决定事项及需要决定的时间点。
- 状态：等待 HU 确认 Phase 0 实施计划。

- HU 确认第 0 阶段计划，开始执行。
- 0.0 环境盘点完成，结果写入 findings.md。重要发现：
  - SDK 58（RN 0.88.1）为 latest；SDK 55 起 New Architecture 强制启用。
  - RN 0.88 移除了 `InteractionManager` → 需求 §6.2-4 需调整（已列入决策候选，待 HU 确认）。
  - iOS 默认 SceneDelegate；新版 Expo Go 尚未上架。
- HU 决定：交互空闲 tracker 改为 idle-callback（rIC + 旧版 InteractionManager 兼容），已同步 requirements.md §6.2-4。
- 0.1 进行中：`spikes/spike-app/` 已用 create-expo-app（blank-typescript, SDK 58）创建，并安装 expo-dev-client、react-dom、react-native-web、@expo/metro-runtime、RNGH 3.3.0。
- 0.1：创建本地 Expo Module `modules/spike-touch`（ios/android，`ping()`；web 端为纯 JS 桩），测试画面 App.tsx（Pressable / RNGH RectButton / 计数器，均带 testID），app.json 设置 bundleId/package `dev.quiesco.spike`、scheme `quiescospike`、expo-dev-client 插件；`.gitignore` 加 /android /ios（CNG）。tsc 通过。
- 启动 AVD `Medium_Phone_API_37.0`（API 37），后台执行 `expo run:android`。
- Android：`expo run:android` 构建成功（51s），安装 dev client；授予 ACCESS_LOCAL_NETWORK 后，用 dev client 深链接加载 Metro bundle（869 modules），测试画面渲染正常，`Native module: android` 证明本地模块已链接。✅
- 踩坑记录：截图全黑（屏幕休眠）、ACCESS_LOCAL_NETWORK 弹窗、dev 菜单、`&` 转义、`uiautomator dump` 卡住 → 已写入 findings。

- Web：同一 Metro 提供 web bundle，Playwright Chromium 渲染成功；testID → `data-testid`。✅
- iOS：`expo run:ios` 因 usbmuxd 失败 → 改用 xcodebuild + simctl install 成功；`simctl openurl` 被 iOS 系统确认框挡住 → 改用 dev-launcher 的 `--initialUrl` 启动参数，渲染成功（`Native module: ios`）。✅
- **0.1 完成**（三端均渲染 spike 画面，本地原生模块在 iOS/Android 已链接）。

- S1：写了 `spike/devtools-hook.ts`（已有 hook 就包装，没有就自装）、`spike/fiber-query.ts`（遍历宿主组件、按 testID 查找、收集文本）、`spike/measure.{native,web}.ts`、`spike/s1-report.ts`；`index.ts` 第一行 import hook。Metro 改为监听模式重启。
  - 第 1 次：`getPublicInstanceFromInternalInstanceHandle` 报 undefined → shim 是 ESM default export，改成 `.default` 后成功。
  - Android / iOS debug 均通过（详见 findings）。
- S1：Android release（`gradlew assembleRelease`，1m23s）安装后 `hookSource=installed`、`bundleType=0`，4/4 命中、坐标与 debug 相同。
- **S1 完成**，结论写入 `docs/spikes/01-fiber-query.md`。

- S2：确认 `onPostCommitFiberRoot` 不可靠（只有存在被动 effect 时才调用）→ 改为 A（root 字段）+ B（替换 scheduler 导出函数跟踪挂起任务）。
  - 6 个场景（basic / effect 链 / transition / Suspense / deferred / Activity），Android debug、Android release、iOS debug 都运行过。
  - 发现 iOS 单次检查误判（定时器批量执行 + microtask 未清空）→ 两次确认后误判为 0。
  - 排查「定时器延迟」：是测试代码的长渲染造成的。
  - Fast Refresh 会保留状态、污染测量 → 每次测量前都强制结束 App 再启动。
- **S2 完成**，结论写入 `docs/spikes/02-react-idle.md`。

- S3：Kotlin 实现 `tap` / `touchDown` / `touchUp`（MotionEvent → Activity.dispatchTouchEvent），`gradlew assembleDebug` 27s。
  - 第 1 次：按下态检查失败（样式三个时刻都是 pressed）→ 原因是 Pressability 的 minPressDuration 定时器，改为等待样式变化并记录耗时 → 确认按下态正常，抬起后 117ms 恢复。
- **S3 完成**，结论写入 `docs/spikes/03-android-touch.md`。

- S4：读 KIF 源码（gh api）整理出 UITouch / UIEvent / IOHIDEvent 的合成步骤（写入 findings）。写 `modules/spike-touch/ios/QSTouchInjector.{h,m}`（ObjC，私有 API）+ Swift 模块 `tap` / `touchDown` / `touchUp`；podspec 加 `s.frameworks = 'IOKit'`；`s3-run.ts` 改为 iOS 也执行。pod install + xcodebuild 成功。
  - 第 1 次运行报 `undefined is not a function`：是旧版 App 被 Fast Refresh 重新加载（原生模块还没有 tap），重新安装后正常。
- **S4 完成**，结论写入 `docs/spikes/04-ios-touch.md`。

- S5：原生 `getLaunchParams()`（Android Intent extras / iOS UserDefaults），`spike/s5-connect.ts`，Host `spikes/host/ws-host.mjs`（ws@8）。
  - Web（initScript / query）、Android debug、iOS debug、Android release 全部握手成功。
  - 一开始的 `no params` 是 iOS App 被 Fast Refresh 重载打出的（那次没有带参数），Android 侧其实读到了；第一次连接失败是因为 Host 已经超时退出。
  - Android release：明文 WS 没有被拦截（与官方文档不一致）；`pm revoke ACCESS_LOCAL_NETWORK` 无效（targetSdk 36）。
- **S5 完成**，结论写入 `docs/spikes/05-connection-params.md`。

- S6：JS 方案 A（App 代码中的环境变量守卫）和 B（Metro resolver 桩）都能剔除；A′（node_modules 内部的守卫）无效 → 采用 B。原生：config plugin `plugins/with-quiesco-native.js` 注入 autolinking exclude。
  - 用副本验证无效（node_modules 符号链接）→ 改在主项目上 `prebuild --clean`。
  - dexdump 按类名检查无效（R8）→ 改为检查 Module 名称字符串。
  - 主项目已用 e2e 模式 `prebuild --clean` 恢复（ios/build/dd 被清空）。
- **S6 完成**，结论写入 `docs/spikes/06-prod-strip.md`。

- S7：Web 端运行 S1/S2（dev server + 静态导出）。Host 侧脚本 `spikes/host/s7-web.mjs`（在 host 包中安装 playwright@1.65.0 作为 devDependency）。
  - 第 1 次：按宿主 props 的 testID 查询全部找不到（符合预期）；通用算法能找到但 RNGH 多命中一个包装 div；按钮文本为空 → 改为 `testID ?? data-testid` 规则，并修正文本收集。
  - 修正文本收集后，确认 Android 上没有重复计数。
- **S7 完成**，结论写入 `docs/spikes/07-web-fiber-query.md`。

- 0.9：静态检查 SDK 55–58 捆绑的 RN 0.83.10 / 0.85.3 / 0.86.3 / 0.88.1，关键 API 均存在。写 `docs/spikes/00-summary.md`（结论一览、对 Phase 1 的影响、最低 SDK 建议 58、Expo Go 未验证）。
- **Phase 0 完成。**
- HU 决定：最低 SDK 58（§11-2），CI 用 GitHub Actions（§11-4）。
- 输出 Phase 1 实施计划（写入 task_plan.md）。
- HU 确认 Phase 1 计划，并决定把后门 / 软重置的最小实现提前到 Phase 1（任务 1.4b）。


## Session 2 — Phase 1
- 1.1 骨架完成：根配置（package.json / pnpm-workspace / .npmrc / tsconfig.base / eslint / vitest projects / dependency-cruiser）、4 个包（protocol / agent / core / cucumber）的骨架与冒烟测试、`.github/workflows/ci.yml`。
  - `pnpm run check`（build → lint → depcruise → test）本地通过：4 个测试文件 4 个测试通过。
  - 依赖规则的反向测试：故意制造 4 处违规，全部被拦住。
  - GitHub Actions 尚未在远端实际运行（还没有 push）。
- 1.2 protocol 完成：json / constants（协议版本、启动参数键、默认端口 7357、WS 关闭码、同步默认值）/ matcher / element / actions（含 HostInput）/ assertions / errors（JSON-RPC 标准码 + Quiesco 1001–1013，按错误名定型的 data）/ events / methods（AgentMethods、HostMethods、TrackerState）/ messages（JSON-RPC 封装与按方法区分的请求联合类型）。
  - 第 1 次构建失败：interface 不满足 `Record<string, …>` 约束 → 改为映射类型约束。
  - 测试：常量完整性 4 个 + 类型测试 7 个（vitest typecheck 模式）。**更正（1.4b）**：当时类型测试实际上没有被 tsc 检查，「`@ts-expect-error` 实际生效」的记录有误；1.4b 修复后这 7 个测试本身都通过。
- 1.3 agent 底层完成（从 spike 代码整理）：
  - `fiber-adapter/`：hook（包装/自装、幂等、渲染器校验、装得太晚检测 lateRenderers + checkRendererSeen）、scheduler 补丁（检测 B）、FiberRoot 字段（检测 A）、traverse（HostNode 树、文本/ownText、Singleton 透明、Hoistable 跳过、scope）、host（native / web 平台差异、样式隐藏、取坐标、视口）、default-deps(.native).ts。
  - `query/`：Matcher（id/text/label/role/within/index，text 取最深匹配）、resolveOne（ELEMENT_NOT_FOUND / MULTIPLE_MATCHES）、可见性规则、summarize / getTree / structureHash。
  - `sync/`：network、timer、react、idle-callback（含旧版 InteractionManager）、frame-stable、SyncEngine（两次确认、超时列出 describeBusy）。`errors.ts`：QuiescoError。
  - 修正：首次测试 2 处失败都是测试代码问题（spy 引用被包装覆盖、fake setTimeout 丢参数）；lint 的 no-this-alias 配置为允许 `self`。

- 提交 1.3（f22198d）。
- 1.4 agent 上层完成：
  - protocol：`AgentConfig`（hello 返回值）、`SyncDefaults.retryIntervalMs`。
  - fiber-adapter：HostNode 增加 `ownerProps()` / `findHandler()` / `findInstance()`（ClassComponent）。
  - tracker 可在安装后重新配置（ignoreUrls、阈值、interval、帧数）；SyncEngine 可按名称开关 tracker；idle-callback 的 InteractionManager 改为挂载时再接入。
  - 新增：`connection/`（params 优先级、AgentClient：hello、请求分发、事件缓冲、退避重连、4001/4002/4003 不重连）、`events.ts`（console 转发按级别、ErrorUtils、window error/unhandledrejection）、`actions/js.ts`、`assertions/`、`runtime.ts`、`singleton.ts` / `install.ts`、`root/QuiescoRoot.tsx`、`stub.ts`、`metro.cjs`（withQuiesco）。
  - 遇到的问题：pnpm 自动安装 peer（见 Errors）；runtime 测试 3 个超时 → 测试中 fake timers 没有推进（加 `drive()`），非代码问题。

- 提交 1.4（d88bcbc）。
- 1.4b 完成：`api-types.ts`（QuiescoApi / StorageAdapter）、`api.ts`（`quiesco` 对象）、`backdoor.ts`、`json-check.ts`、`reset/`（ResetManager、storage-defaults(.native).ts）、runtime 增加 `backdoor` / `reset` handler；stub 导出同名 no-op。
  - 确认 Metro `allowOptionalDependencies` 默认开启，`try` 块内的 require 视为可选依赖；AsyncStorage 3.1.1 默认导出为带 `clear()` 的旧版存储。
  - 反向测试发现类型测试一直没有生效（见 Errors），已修复。

- 提交 1.4b（80326df）。
- 1.5 core 完成：`errors.ts`（QuiescoError，保留 agent 错误码与 data）、`config.ts`（defineConfig / loadConfig / resolvePlatform / toAgentConfig / serverPort）、`matcher.ts`、`json.ts`、`logger.ts`、`server/ws-server.ts`（QuiescoServer + AgentConnection）、`driver.ts`、`session.ts`（Session / createSession / createProvider）、`devices/{provider,exec,permissions,android}.ts`。依赖 `ws` 8.22.1。
  - 真机冒烟（emulator-5554，API 37）：attach 1.2s、install 检查、截图（PNG 106KB）、diagnose 正确；发现并修复 AVD 名称识别问题（见 Errors）。
  - Node 原生加载 `.ts` 配置（dist + 临时目录）成功。

- 提交 1.5（1e01fbe）。
- 发现 1.1 的 `node-linker=hoisted` 实际没有生效（pnpm 12 忽略 .npmrc 中的 pnpm 设置），改到 pnpm-workspace.yaml；**更正**：1.1 记录的「hoisted 布局」在 1.6 之前并未生效。
- 1.6 cucumber 完成：core 新增 `tags.ts`（runsOnPlatform / tagNames）与 `config.tags`；cucumber 包：`lifecycle.ts`、`world.ts`（QuiescoWorld，`this.app` / `this.session`）、`register-hooks.ts`（registerQuiesco）、`register.ts`、exports `./register`；`@cucumber/cucumber` 13.3.0 为 dev + peer 依赖。
  - 集成测试用 cucumber 编程式 API 真实运行 4 个场景：软 / 硬重置顺序、`@web` 在 android 上被跳过、失败场景附加 PNG + JSON、AfterAll dispose。

- 提交 1.6（cb736d6）。
- 1.7 示例 App 完成：create-expo-app（blank-typescript@sdk-58）→ `expo install` expo-router / dev-client / async-storage 2.2.0 等（expo-doctor 20/20）；`src/app`（登录 / 待办列表 / 新建）、`store.ts`、`api.ts`、`e2e.ts`（loginAs / seedTodos / onReset，仅 e2e 构建加载）、`ScreenTransition`、mock server（MOCK_DELAY_MS）、features（§9 新建待办 + 登录）、steps、support、`quiesco.config.mts`、`metro.config.js`、README。
  - Metro 打包验证：e2e 包含 agent 特征字符串，生产包为 0。
  - dev client APK 构建成功（prebuild + assembleDebug）。
  - 真机首次运行：4 场景 22 步全部通过；反向验证（期望不存在的待办）按预期失败，信息含 expected / actual，HTML 报告含截图与 JSON 附件。

- 提交 1.7（c183a31）。
- 1.8 验收（Android Emulator API 37，dev client，js 档位）：
  1. 第 9 节场景 + 登录：默认设置连续 3 次全部通过（约 12.3s/次）。
  2. `MOCK_DELAY_MS=2000` + `EXPO_PUBLIC_TRANSITION_MS=1000`（重启 Metro，确认 bundle 中 env 为 "1000"），测试不改，连续 3 次全部通过（约 39s/次，耗时增加说明确实在等待）。
  3. 同步超时诊断：`MOCK_STALL="POST /login"` → `SYNC_TIMEOUT … network: POST http://localhost:3001/login (9903ms)`；临时 backdoor 启动 1s 循环定时器 → `timer: setTimeout(ticker, 1000ms), fires in 265ms`（临时代码已撤回）。
  - 顺带确认：未注册 backdoor 的错误在真机上列出已注册名称。
  - 注意：Metro 以 `CI=1` 启动时不监听文件变化，改代码后需要重启 Metro。
- 撤回临时代码后用提交状态再跑一次：4 场景 22 步通过。**Phase 1 完成。**

- 提交 1.8（790d2cc）。HU 确认 Phase 2 计划（三项决定均按推荐）。
- 2.0：搭 `packages/native` 初版 + 临时 probe backdoor，4 项验证全部成立（findings「Phase 2.0 验证」）。构建踩坑：包名不能含 `native`、需 react-android 依赖、autolinking search 需 `-p android`。
- 2.1–2.5：native 模块（getLaunchParams / locate / tap / swipe / typeText）；config plugin（两种模式 prebuild 验证）；agent native 档位（performer、ready 检查、hitTest、ELEMENT_OBSCURED、原生启动参数）；示例 App 自动档位 + Modal「清空待办」feature。
  - 单元测试发现：命中检测按对象比较误报「被自己遮挡」→ 改为按 view tag 比较。
  - Phase 1 遗留修复：SYNC_TIMEOUT 显示总超时；识别不出的 AVD 不再重复启动 emulator（先查 ps）。
- 2.6 基准脚本 `examples/todo-app/bench/run.mts`；结果写入 `docs/benchmarks.md`。
- 2.7 验收全部完成。**Phase 2 完成。**

- 提交 Phase 2（d0584d1）。HU 决定 §11-6 只验收 Chromium、§11-7 三视口都验收。
- Phase 3（进行中）：`@quiesco/web`（WebProvider + 静态服务器）、core 动态加载 web provider、host performer（HostInput）、透明重连、appErrors 忽略配置、Android 用户解锁等待；示例 App Web 静态输出与三视口配置。
  - 首次 Web 运行 6/6 失败 → 两个问题：Web 无 native tag 导致「被自己遮挡」（改为 isSameElement）；Expo Router 静态 Web 的 `Requiring unknown module "818"` 被当作致命错误（查明为框架行为，真实用户同样触发，加默认忽略规则）。
  - 测试中发现一处固定 sleep（违反 §12）已改为 expect.poll；一处未处理的 Promise 拒绝已修。
  - 环境：Emulator 夜间 system_server 软重启后用户卡在 BOOTING（Activity class does not exist）→ `adb reboot` 恢复；之后负载长时间偏高（ANR 对话框、bundle 下载 >30s），Android 侧验证暂停。

## Test Results
| 测试 | 结果 | 备注 |
|------|------|------|
| 0.1 Android dev client 渲染 spike 画面 | ✅ | API 37 Emulator，截图确认 |
| 0.1 Web（Chromium）渲染 spike 画面 | ✅ | playwright 1.65.0，截图 scratchpad/web-01.png |
| 0.1 iOS Simulator 渲染 spike 画面 | ✅ | iPhone 17 / iOS 27.0，`--initialUrl` 启动 |
| S1 Android debug：按 testID 查询 + 坐标 | ✅ | 4/4 命中，坐标与截图误差 ≤1px |
| S1 iOS debug：按 testID 查询 + 坐标 | ✅ | 4/4 命中，坐标与截图吻合 |
| S1 Android release：自装 hook | ✅ | hookSource=installed，4/4 命中 |
| S2 Android debug：6 场景，A&&B 两次确认 | ✅ | 误判 0 |
| S2 Android release：6 场景 | ✅ | 误判 0 |
| S2 iOS debug：6 场景 | ✅（两次确认） | 单次检查误判 1（Suspense），两次确认 0 |
| S3 Android：Pressable onPress / 按下态 / RNGH / 10 连击 / 空白处 | ✅ | 往返 83–138ms |
| S4 iOS：Pressable onPress / 按下态 / RNGH / 10 连击 / 空白处 | ✅ | 往返 83ms，截图一致 |
| S5 Web initScript / query 握手 | ✅ | ping 0–1ms |
| S5 Android debug（VIEW Intent + extras） | ✅ | 3.9s 连上，ping 4ms |
| S5 iOS debug（进程参数） | ✅ | 3.7s 连上，ping 1ms |
| S5 Android release（extras，无 Metro） | ✅ | 2.4s 连上，ping 10ms |
| S6 JS：export 三端，e2e 关闭时没有 agent 特征字符串 | ✅ | 方案 A/B 都有效，A′ 无效 |
| S6 原生：生产模式下 iOS Podfile.lock / Android release APK 中没有模块 | ✅ | e2e 对照组存在 |
| S7 Web dev：查询 / 文本 / 坐标 / S2 | ✅ | 坐标与 Playwright 完全一致，S2 误判 0 |
| S7 Web 静态导出（prod）：同上 | ✅ | hook 自装，data-testid 在 prod 下仍存在 |
| S7 回归：Android 文本收集没有重复 | ✅ | |
| 1.1 `pnpm run check` | ✅ | build / lint / depcruise / test（4/4） |
| 1.1 依赖规则反向测试 | ✅ | 4 处故意违规全部被拦住 |
| 1.2 `pnpm run check` | ✅ | 7 文件 25 测试，类型测试无错误 |
| 1.3 agent 单元测试 | ✅ | 7 文件 54 测试（fiber-adapter 18 / query 13 / sync 23） |
| 1.3 `pnpm run check` | ✅ | build / lint / depcruise（45 模块无违规）/ test 13 文件 78 测试 |
| 1.3 新依赖规则反向测试 | ✅ | query 直接 import `fiber-adapter/fiber` 被拦住 |
| 1.4 agent 单元测试 | ✅ | 15 文件 99 测试（新增 actions-js / assertions / client / events / params / runtime / metro 等） |
| 1.4 `pnpm run check` | ✅ | build / lint / depcruise（63 模块无违规）/ test 20 文件 125 测试，类型测试无错误 |
| 1.4b agent 单元测试 | ✅ | 新增 backdoor-reset（findNonJson / 注册表 / ResetManager / web 存储 / stub）、runtime 的 backdoor 与 reset、stub 导出一致性类型测试 |
| 1.4b 类型测试反向测试 | ✅ | protocol 中故意写错类型、agent index 多一个导出，均被 vitest typecheck 报出 |
| 1.4b `pnpm run check` | ✅ | build / lint / depcruise（71 模块无违规）/ test 139 个，类型检查无错误 |
| 1.5 core 单元测试 | ✅ | 6 文件 34 测试（server 8 / driver 7 / android 10 / session 4 / config 5），WS 用真实 socket + 假 agent |
| 1.5 Android provider 真机冒烟 | ✅ | boot(attach) / install 检查 / screenshot / diagnose |
| 1.5 `pnpm run check` | ✅ | build / lint / depcruise（90 模块无违规）/ test 172 个，类型检查无错误 |
| 1.6 cucumber 测试 | ✅ | lifecycle 6 个 + 真实 cucumber-js 运行 1 个 |
| 1.6 `pnpm run check` | ✅ | build / lint / depcruise（96 模块无违规）/ test 180 个，类型检查无错误 |
| 1.7 Metro 打包（e2e / 生产） | ✅ | 生产包 agent 特征字符串 0，e2e 包存在 |
| 1.7 Android Emulator 真机 e2e | ✅ | 4 场景 22 步通过（12.6s，含安装与启动） |
| 1.7 反向验证 | ✅ | 故意失败的场景报 ASSERTION_FAILED（expected "不存在的待办"，actual "写周报"），报告含 PNG + JSON |
| 1.7 `pnpm run check` | ✅ | 包检查 180 个测试 + 示例 App 类型检查 |
| 1.8-1 第 9 节场景（默认设置）×3 | ✅ | 每次 4 场景 22 步通过，约 12.3s |
| 1.8-2 2s 网络延迟 + 1s 页面切换 ×3（测试不改） | ✅ | 每次 4 场景 22 步通过，约 39s |
| 1.8-3 同步超时：未完成请求 | ✅ | `network: POST http://localhost:3001/login (9903ms)` |
| 1.8-3 同步超时：未触发定时器 | ✅ | `timer: setTimeout(ticker, 1000ms), fires in 265ms` |
| 1.8 最终运行（提交状态） | ✅ | 4 场景 22 步通过；`pnpm run check` 180 测试 + 示例类型检查通过 |
| 2.0 原生验证 4 项 | ✅ | view tag 坐标与 JS 一致；Modal 内点击生效；中文 commitText 触发 onChangeText；被 Modal 遮挡的窗口 hasWindowFocus=false |
| 2.2 config plugin prebuild（生产 / e2e） | ✅ | 生产：settings.gradle 排除模块；e2e：manifest + main/debug 两份网络配置 |
| 2.5 native 档位全部 feature | ✅ | 6 场景 34 步（19.3s）；js 档位同样通过（16.0s） |
| 2.5 遮挡反向验证（真机） | ✅ | Modal 打开时点下层按钮 → ELEMENT_OBSCURED |
| 2.7 连续 20 次（native） | ✅ | 20/20，每次 6 场景 34 步，16.9–19.8s（中位数 17.8s） |
| 2.7 性能基准 | ✅ | 软重置中位数 195ms（native / js 相同，目标 <500ms）；tap 含同步 native 416ms / js 266ms；全量 18.8s / 16.0s |
| 2.7 `pnpm run check` | ✅ | 196 测试 + 示例类型检查，depcruise 103 模块无违规 |
| 3.x Web（Chromium）静态导出 × 手机 / 平板 / 桌面 | ✅ | 各 6 场景 34 步通过（约 6s） |
| 3.x Web 开发服务器（expo start --web） | ✅ | 6 场景 34 步通过（8.5s） |
| 3.4 整页跳转 / 硬重置后透明重连 | ✅ | openUrl 后与新 context 后断言均通过（连接数 1→2→3） |
| 3.6 屏蔽 Playwright 跑 Web | ✅ | 明确报错并给出安装命令 |
| 3.6 屏蔽 Playwright 跑 Android | ✅ | Emulator 冷启动 + Wipe Data 后：6 场景 34 步通过（21.6s），native module true |
| 3.x Android 全新安装（卸载后首次运行） | ✅ | 首次失败：expo-dev-menu 首启自动弹出菜单 → 6 场景均报 ELEMENT_OBSCURED（判断正确）；启动 URL 加 `__expo_disable_auto_launch=1` 后 6 场景 34 步通过 |
| 3.7 Web 连续 20 次 × 3 视口 | ✅ | 手机 / 平板 / 桌面各 20/20，每次 6 场景 34 步，5.96–6.27s |
| 3.7 `pnpm run check`（最终） | ✅ | 220 测试，depcruise 111 模块无违规，类型检查无错误 |
| 4.0 iOS 原生验证 6 项 | ✅ | tag→UIView 坐标与 JS 一致；Modal 遮挡（跨窗口 hitTest）5/5，转场 settling 等待；中文 insertText；swipe 惯性 + scrollTo；App 内 open(ownScheme) 无确认框；启动参数关闭 dev menu / FAB（含对照组） |
| 4.1 native iOS 正式实现 | ✅ | 错误码统一（E_UNSUPPORTED / E_NO_VIEW / E_NOT_TEXT_INPUT / E_BAD_URL，Android 同步）；openUrl 只保留 App 内 UIApplication.open；agent 映射原生错误（ACTION_NOT_SUPPORTED + js 提示 / ELEMENT_NOT_FOUND）；回归：Modal 5/5、中文输入、swipe 惯性 1140pt、openUrl 3 次 + 非法 URL 拒绝；`pnpm run check` 229 测试 |
| 4.2 agent：openUrl 走 App 内 | ✅ | 原生模块有 openUrl（iOS）时在 App 内打开并同步，否则照旧交给 Host；opened=false → ACTION_NOT_SUPPORTED；pressBack 仍交给 Host（iOS provider 在 4.4 拒绝，平台分支留在 provider）；iOS 实测 driver.openUrl 3 次（约 417ms，含同步）；134 个 agent 测试 |
| 4.3 `@quiesco/expo-plugin` | ✅ | 真实项目 prebuild：生产 → Podfile `use_expo_modules!(exclude: ['@quiesco/native'])`、Podfile.lock 中 QuiescoNative 0 处、settings.gradle exclude；e2e → Podfile 原样、lock 4 处、manifest + 两份 xml、ATS NSAllowsLocalNetworking；重建后 Android e2e 6 场景 34 步通过（18.9s，含 4.1 的 Android 改动）、iOS openUrl 冒烟通过；`pnpm run check` 235 测试（vitest 配置改 .mts 消除 Vite 警告） |
| 4.4 core IosProvider | ✅ | simctl：选模拟器（udid > 名称+os > 已启动）、boot + bootstatus、install、launch（-quiescoPort/-quiescoSession，dev client 带 --initialUrl + 关闭 dev menu 参数）、privacy 授权（camera/notifications 警告）、截图、pressBack / Host 深链接报 ACTION_NOT_SUPPORTED、diagnose；实机：全新安装 4.0s 连接、硬重置 2.1s 重连；13 个单元测试 |
| 4.4 附带修复：断言错误类型 | ✅ | 重试同步被截止时间截断时报 SYNC_TIMEOUT 的竞态 → 改为 ASSERTION_FAILED；新增 2 个测试（无修复时失败）；iOS / Android 复现脚本 A–D 全部正确 |
| 4.5 示例 App iOS 跑通 | ✅ | iOS 全量 6 场景 3/3 次通过（16.4–17.8s）；Android 6/6（17.8s）；Web 三视口各 6/6；`pnpm run check` 256 测试。期间修复：软重置时 QuiescoRoot 卸载即断连（agent 延迟 stop）、iOS 26+ 内容在导航栏下（示例：透明 header + useHeaderHeight）、Modal 未进窗口立即失败、键盘移动 / 刚输入后的触摸被丢（native settling 400ms）、导航转场检测递归、原生 UI 转场纳入同步（新 `native` tracker）、「保存密码？」系统弹窗（provider 关闭模拟器 AutoFill）、ELEMENT_OBSCURED 附原生命中链；`build:android` 补 EXPO_PUBLIC_QUIESCO=1；新增 build:ios / test:e2e:ios / eas.json e2e profile |
| 4.6 单元测试 / 类型 / lint | ✅ | core 77 + agent 142 测试通过（新增：Android serials / AVD 端口绑定 + read-only / 设备不足报错；iOS 创建与复用 worker 模拟器 / udids / 不把 worker 模拟器当默认；config 函数；hello 带 workerIndex；quiesco.workerIndex()）；示例类型检查与 eslint 无错误 |
| 4.6 Web `--parallel 2` | ✅ | 6 场景 34 步通过，4.2s（串行 6.3s）；临时请求计数确认 :3001 / :3002 各收到 11 个请求（隔离生效，临时代码已还原） |
| 4.6 iOS `--parallel 2` | ⏸ | 第一次 5/6：worker 1 自动创建 "iPhone 17 (Quiesco 1)"、安装、连接成功；失败原因是 8082 上的 Metro（14:35 启动，未装 watchman）漏掉文件变更，App 仍在跑旧 bundle（backdoor 列表里还有已还原的 4.0 探针）⇒ 两台 App 都打到 3001。重启 Metro 被权限拦下，待 HU 重启后重跑 |
| 4.6 iOS `--parallel 2`（Metro 重启后） | ✅ | 6 场景 34 步通过，11.2s（串行 19.4s）；:3001 13 个 / :3002 11 个请求（隔离生效） |
| 4.6 Android 修复 ①：全部实例 `-read-only` | ✅ | 模拟器只允许「全部实例都 read-only」时多开同一 AVD；worker 0 也改为 read-only；已有可写实例时 7s 内报错并给出 `adb -s emulator-5554 emu kill`（单元测试覆盖） |
| 4.6 Android 修复 ②：冷启动 `-no-snapshot-load` | ✅ | quick-boot 快照在 /data 重装 APK 后过期，开机约 30s 后用户空间重启（reverse 与 App 消失）⇒ 串行 / 并行冷启动都失败；改为真冷启动 14s（快照 + 重启 40s）；之后冷启动并行 2/2、串行 1/1 通过 |
| 4.6 Android 修复 ③：启动参数丢失（native） | ✅ | 第二次起 dev client 以 CLEAR_TASK 重新启动 Activity，intent 没有 extras ⇒ App 退回构建期端口 7357（实测 worker 1 App 连到 7357；串行因端口恰为 7357 未暴露）。加 `QuiescoNativePackage`（ReactActivityLifecycleListener 保存参数）后重建 APK（类已确认在 dex 中）；热启动并行仍 0/3，症状变化（白屏、App 未运行、7357 也超时），机器 load 10–13（2 台 emulator + 2 台 iOS 模拟器）。待与 HU 确认方向 |
| 4.6 Android 修复 ④：Android 17 包更新占位 Activity | ✅ | 真正的热启动失败原因（与负载无关）：App 在前台时 `install -r` ⇒ SystemUI 往任务里放 PackageUpdateActivity 占位，更新结束（约 2.4s 后）以 CLEAR_TASK 重新启动任务的 base intent（无 extras），覆盖我们的 `am start`；时机竞争 ⇒ 症状不定。install 前 `am force-stop` 后系统日志为「no process with activities in it」，不再放占位（单元测试覆盖） |
| 4.6 Android `--parallel 2`（热启动） | ✅ | 连续 3/3，6 场景 34 步，14.0–14.5s（串行 18.6s）；关闭 iOS 模拟器后 load 约 2.8 |
| 4.6 `pnpm run check` | ✅ | 271 测试，depcruise 116 模块无违规，类型检查无错误 |
| 4.7 `scripts/check-prod-strip.mjs` + `prod-strip.yml` | ✅ | 扫描 / 判定逻辑 `scripts/prod-strip/scan.mjs` + 5 个 vitest 测试（vitest 新增 scripts project）；已有 android/ios 且无 `--allow-clean` 时退出码 2（实测）；workflow YAML 可解析，CI 实跑待推送后确认 |
| 4.7 本机实跑（三端 × prod / e2e） | ✅ | Web：3 个 JS 特征 prod 0 / e2e 4、6、1；Android（R8 release APK，dex + Hermes bundle）：`QuiescoNative` prod 0 / e2e 3，JS 特征 prod 0 / e2e 各 1（构建 115s / 98s）；iOS（Release simulator .app）：`QSTouchInjector` 0 / 38、`IOHIDEventCreateDigitizerEvent` 0 / 4，JS 特征 prod 0 / e2e 各 1（198s / 140s）。xcodebuild -quiet 输出的「failed with exit code 0」是 Xcode 27 附在 Pods Swift 警告上的噪音，构建成功 |
| 4.7 环境恢复 + `pnpm run check` | ✅ | `pnpm build:android` 后 Android 串行 6/6（22.4s，iOS 构建同时进行）；`pnpm run check` 276 测试、depcruise 无违规、类型检查无错误；`pnpm build:ios` 后 iOS 6/6（冷启动 + 全新安装 56.0s，热启动 15.9s） |
| 4.8 iOS 串行连续 20 次 | ✅ | 20/20，min 15.9 / median 16.1 / max 17.8s（`bench/suite.mts`） |
| 4.8 iOS `--parallel 2` × 5 | ✅ | 5/5，median 10.8s（min 10.5 / max 14.2）；热身 1 次 49.3s（新建 worker 模拟器） |
| 4.8 Web 串行 / 并行 × 5 | ✅ | 串行 5/5 median 6.4s；并行 5/5 median 4.2s |
| 4.8 Android 串行 × 5 | ❌ | 4/5（18.5–26.8s）；第 1 次（冷启动热身后，load ≈ 12）「取消后待办保留」的 `清空全部待办但取消` 同步超时：frame-stable 元素树 10s 内不稳定（Modal 淡出期间），未定位 |
| 4.8 Android `--parallel 2` × 5 | ❌ | 0/5：串行热身以**可写**方式启动了 emulator-5554，worker 1 被 4.6 的保护拒绝（按设计）⇒ 同一台机器「先串行后并行」需要手动关模拟器，可用性缺口。待 HU 决定 |
| 4.8 偶发失败复现 | ⏸ | 冷启动后 6 次 × 2 轮 + CPU 加压（load 14.7）6 次，共 18 次全通过，未复现；重读原报错：10s 几乎全在点「取消」前的同步（after 只等 36ms），即 Modal 出现后元素树一直在变（淡入只改透明度、不进 hash，应是类型 / 文本 / 位置在变） |
| 4.8 frame-stable 正式诊断 | ✅ | `structureHash` → `structureLines`（每节点一行）；超时时报告「N frames sampled in T ms」与首个变化节点（含节点数变化、长行截断）；agent 144 测试 |
| 4.8 回退并行（HU 决定） | ✅ | protocol / agent / core / cucumber / 示例恢复到 0da158c 后去掉「端口 + N」；保留 `-no-snapshot-load`、install 前 force-stop、native LaunchParamsStore；`--parallel` 时 CONFIG_ERROR（单元测试 + 实测）；README 改为「Serial only」；requirements.md §6.9 / 第 4 阶段同步修改；`pnpm run check` 264 测试；Metro 漏掉 git checkout 的变更 ⇒ 重启（--clear）后确认 bundle 为新代码 |
| 4.8 最终回归（三端串行，最终代码） | ✅ | iOS 20/20（15.9 / 16.1 / 16.4s）；Android 5/5（17.7 / 18.5 / 18.7s）；Web 5/5（6.4 / 6.4 / 6.8s）；`--parallel` 实测报 CONFIG_ERROR；结果写入 docs/benchmarks.md「Phase 4 acceptance」 |
| Phase 4 | ✅ | 完成。遗留：agent「loaded after the React renderer」警告每次 dev client reload 出现（旧 Metro 日志已有 256 次，非本轮引入）；prod-strip.yml 待推送后实跑 |
| 5.0 renderer 早于 agent（Phase 4 遗留） | ✅ | 根因：RN 0.88 `setup-env`（Metro 在入口前执行）加载 renderer ⇒ dev 误报、scheduler 补丁失效（检测器 B 不工作）、**release e2e 构建查不到任何元素**（Android release APK 实测 0/6）。修复：agent `src/early.ts`（hook + scheduler 补丁）由 `withQuiesco` 放到 `getModulesRunBeforeMainModule` 最前（同时写回 Expo 闭包的原始 serializer）；「装得太晚」只在已有 root 时报并接管 root。验证：Android release 6/6（15.1s）、iOS Release 6/6（22.1s）、Android dev 6/6、iOS dev 6/6（17.4s）、Web 6/6；Metro 警告 0；scheduler 启动后记录 18 个任务；`pnpm run check` 268 测试 |
| 5.1 CLI `quiesco`（packages/cli） | ✅ | `test`（设 QUIESCO_PLATFORM、npx cucumber-js 透传、拒绝 --parallel）、`doctor`（Node / Expo / 依赖 / plugin / withQuiesco / 入口首行 / QuiescoRoot / 配置 / simctl / adb+AVD / Playwright Chromium / 构建产物 / 端口，✅⚠️❌ + 修复提示）、`tree`（core 新增 `attachToRunningApp` + server `acceptAny`：只起 server，接受任意 session，打印缩进树；`--launch` / `--json`）、`init`（按包管理器装依赖、`--packages` tarball + overrides、app.json plugin、metro.config.js、index.ts 入口、quiesco.config.ts、cucumber.mjs、features 示例、scripts；不覆盖已有文件）；depcruise 新规则 cli 不得 import 运行器；16 个 CLI 测试 + core attach/server 测试；`pnpm run check` 287 测试。实测（示例 App）：doctor 全 ✅；tree 接上 iOS 上仍在运行的 App（旧 session）并打印当前画面；`quiesco test --platform web --tags …` 6/6；`--parallel` 退出码 2 |
| 5.2 键盘：native 档位自动收起遮挡目标的软键盘 | ✅ | agent `resolveActionTarget`：native 档位解析目标后，若 `Keyboard.isVisible()/metrics()`（新 AppDeps.keyboardFrame）与目标矩形重叠 ⇒ `Keyboard.dismiss()` → 同步 → 重新解析目标；js 档位不处理；单元测试（重叠 / 不重叠 / js）。示例「新建待办」的保存按钮改为贴底（marginTop: auto）。实测：iOS 输入后键盘完全盖住保存按钮（截图，按钮 y=782pt），tap 成功；Android 模拟器默认有硬键盘不弹软键盘 ⇒ 临时 `show_ime_with_hard_keyboard=1`（已还原）后键盘盖住按钮（y=818dp），logcat 显示 tap 期间 App 自己发出 HIDE_SOFT_INPUT（22:38:30.293，tap 29.954–30.719），全量 6/6；默认设置 Android 6/6、Web 6/6 |
| 5.2 权限：示例实际授权场景 | ✅ | 三端都能预授权的是 location（Xcode 27 `simctl privacy` 无 camera / notifications，保持警告跳过）。示例：`permissions: ['location']`、app.json 声明 Android 定位权限 + iOS NSLocationWhenInUseUsageDescription、backdoor `locationPermission`（Android PermissionsAndroid / Web navigator.permissions）、`features/permissions.feature`（@android @web）。结果：Web 7/7（对照：去掉 permissions 后报 "denied"）；Android 重建 dev client 后 7/7，dumpsys `ACCESS_FINE/COARSE_LOCATION: granted=true`；iOS 6 通过 1 跳过，locationd clients.plist `Authorization=2`（对照 revoke=1、grant=2）；`pnpm run check` 288 测试 |
| 5.3 `@quiesco/steps`（中 / 日 / 英） | ✅ | 15 个通用步骤（tap / tapText / longPress / type / clear / scrollTo / dismissKeyboard / pressBack / openUrl / seeText / notSeeText / visible / notVisible / hasText / count），`registerQuiescoSteps({ languages, only })`，用 `defineStep`（与关键字无关）；按表达式参数数生成固定 arity 的函数（cucumber-js 校验 fn.length）；英文参数顺序不同时用 `order` 映射。单元测试：每个示例只匹配自己的表达式（跨语言无歧义，cucumber-expressions 实测）、三语调用同一 Driver 方法、arity、选项过滤。实跑（临时 features-generic/，已删除）：`# language: zh-CN / ja` 与英文三个场景 + 示例 7 场景，Web 10/10、iOS 9 通过 1 跳过（权限场景按设计）；README 由 GENERIC_STEPS 生成步骤表并注明「操作脚本而非需求，只适合原型期」；`pnpm run check` 291 测试 |
| 5.4 文档 | ✅ | `LICENSE`（MIT，Copyright (c) 2026 Quiesco contributors）、各包 license 改为 MIT；根 README（简介、Web 10 分钟快速开始、iOS / Android、包一览、文档索引、从源码使用、许可证）；docs/api.md（Driver、Matcher、App 内 API、配置表、tag、错误码、无 Cucumber 用法）、sync.md（tracker、SYNC_TIMEOUT 按 tracker 处理、`sync: false`）、platforms.md（三端差异表、权限映射表、各平台注意点）、driver-pattern.md（业务 Driver + World、Ports & Adapters 的 API 实现）、cli.md、troubleshooting.md（按症状）。文档中的输出格式 / 行为对照代码核对（describeBusy 格式、无原生模块时的行为已据此更正）；相对链接与锚点脚本检查 0 错误。快速开始的命令在 5.5 用全新项目实测后再修正 |
| 5.5 验收（第一轮，全新 create-expo-app SDK 58） | ⏸ | 模板：Expo Router、根布局在 `src/app/_layout.tsx`、`web.output: "server"`。① `init --packages` 在 npm 下报 EOVERRIDE（直接依赖不能同时出现在 overrides）⇒ 已修：npm 只 pin 非直接依赖（单元测试已加），init 4s 通过；② `npm run e2e:web` 失败：SSR 导出（dist/client + dist/server，无 index.html），@quiesco/web 只支持静态导出；手动 `npx expo serve` + `url` 可连上；③ 连上后 SYNC_TIMEOUT：frame-stable 报模板首页一个 div 尺寸持续变化（新诊断直接定位：228→229px），即模板 `animated-icon` 的 4 分钟旋转光晕装饰动画。②③ 需 HU 决定 |
| 5.5 修复（HU 决定） | ✅ | ① `@quiesco/web`：distDir 有 client/ + server/（Expo server 输出）时自动 `npx expo serve <distDir> --port <空闲端口>`（注意：参数是导出目录；传项目目录会被当静态目录 → 404），轮询到 200 再打开，结束时关闭；单元测试 4 个。② `sync.ignoreElements`（MatcherInput[]，经 hello 下发 Matcher）：匹配元素及子树不参与 frame-stable；单元测试（structureLines skip、toAgentConfig）。③ init：npm 只 pin 非直接依赖（EOVERRIDE）、生成 `quiesco.config.mts`（避免 MODULE_TYPELESS 警告）、配置里带 `ignoreElements` 注释示例、Next 提示装饰动画。README 快速开始改为模板实际路径（src/app/_layout.tsx）并加装饰动画一步 |
| 5.5 验收（全新 create-expo-app，按 README） | ✅ | 共 4 轮（全新项目 + 重新 pack）：第 1 轮 EOVERRIDE；第 2 轮 SSR 无 index.html + 装饰动画 SYNC_TIMEOUT；第 3 轮 `expo serve` 参数错（传了项目目录）；**第 4 轮通过**：create-expo-app 7s → `init --packages` → README 手动 3 步（QuiescoRoot、testID home、glow testID + 取消注释 ignoreElements）→ `npm run e2e:web`：1 scenario / 3 steps 通过，init 开始到通过的工具耗时 9s，`doctor --platform web` 全 ✅，无警告。对照：注释掉 ignoreElements ⇒ SYNC_TIMEOUT 并指出 `div#logo-glow`。npm 缓存与 Chromium 已在本机（冷环境需额外下载，估计仍远低于 10 分钟；人工改 3 处文件约 2–3 分钟）。仓库 `pnpm run check` 297 测试；示例 Web 7/7 |
| Phase 5 | ✅ | 完成：5.0 renderer 早于 agent（release e2e 修复）、5.1 CLI、5.2 键盘 / 权限、5.3 steps（中日英）、5.4 文档 + MIT、5.5 全新项目验收。遗留：prod-strip.yml 推送后实跑；原生平台的全新项目流程未实跑（README 指向示例 App 的已验证步骤） |

## Session 2026-11-08（Phase 6 启动）
- 文档：README / docs/api.md 补充 Jest / Vitest 直接调用 `@quiesco/core` 的用法（提交 d1402ad）；Vitest 示例未实跑。
- HU 要求 Phase 6：补齐相对 Detox 的全部缺口并优化。已建 Phase 6 骨架；并行调研 Detox API（官方文档）与 Quiesco 动作链路。
- 调研完成（findings.md 调研 A / B）；Phase 6 拆为 6.0–6.14 写入 task_plan.md。
- HU 决定：重做并行、iOS 系统弹窗先 spike、做真机与 LLM 驱动、按编号顺序。下一步 6.1。
| 6.1 代码 + 单测 | ✅ | protocol（Matcher id 正则 / type / has / not；断言 visible{ratio} / notVisible{ratio} / focused / enabled / checked / value / label 及 not 标志；ElementSummary 加 semanticType / focused / enabled / checked / value / visibleRatio）；fiber-adapter（ownerNames、isFocused、clipsContent、inputValue，平台差异只在 host.ts / default-deps）；query（semantic.ts 语义类型 + 状态；visibility 加祖先裁剪与比例）；core（expectFocused 等 8 个方法、attributes()、链式 `expect(t)[.not]`、options.ts 拆出以消除 driver↔expect 环）。新增测试：agent semantic.test.ts + fiber-adapter 3 个、core expect.test.ts。`pnpm run check`：343 测试、depcruise 0 违规（第一次因 driver↔expect 环失败，已修）|
| 6.1 Web 实测 | ✅ | 首轮 8/9（RNW Switch 被数成 2 个）→ 部件规则；第二轮 8/9（label 在部件上，且报错误导为 SYNC_TIMEOUT）→ label 回退 + ELEMENT_NOT_FOUND 优先（反向测试：去掉修复后新测试失败）；最终 mobile / tablet / desktop 各 9/9（8.5s） |
| 6.1 iOS / Android 实测 | ✅ | 旧 Metro（8082，无 watchman）看不到新文件 semantic.ts；停止它被权限拒绝 → 另起 8083 `--clear` 并确认 bundle 含新代码。iOS 8 通过 + 1 按 tag 跳过（25.5s，真实触摸）；Android 9/9（冷启动 Medium_Phone_API_37.0，1m4.6s）。包含既有场景在新可见性规则（祖先裁剪）下的全量回归 |
| 6.1 收尾 | ✅ | docs/api.md（断言表、链式 expect、attributes、Matcher、语义类型三端映射表、可见性规则）；RNW 组件 displayName 实查确认映射表；`pnpm run check` 350 测试、depcruise 0 违规。遗留：8083 上的 Metro 仍在后台运行；旧 8082 Metro 仍是旧代码（需 HU 重启） |
| 6.2 原生 | ✅ | iOS / Android 新增 `gesture`（单指定时路径）、`pressKey`；iOS 另增 `hitAt` 与 locate 的 `hitTags`；两端 dev client 重建成功 |
| 6.2 代码 + 单测 | ✅ | protocol（multiTap / replaceText / pressKey / scrollToEdge / scrollToIndex / drag / tapAt / longPressAt，point / from / distance）；agent 三档位（hit-test.ts 拆出）、runtime（pointInside、resolveExisting、scrollToEdge、scrollToIndex）；fiber-adapter `focus()`、`InstanceRef.raw()`；core Driver 新方法 + 参数校验 + 多步动作 Host 等待；web drag holdMs。`pnpm run check` 375 测试 |
| 6.2 实跑 | ✅ | 示例新增 playground 页 + actions.feature（5 场景）+ 新建待办回车保存。Web 三视口各 15/15；iOS 14 通过 + 1 按 tag 跳过；Android 15/15（1m58s）；iOS js 档位（not @needs-touch）13 通过 + 1 跳过。期间修复见 Errors 表。临时 Metro 已停止 |
| 6.3 计划 + spike | ✅ | HU 决定：无宿主组件回退、无障碍动作走原生真实路径、iOS 滚轮真实滚动。示例装 slider 5.2.1 / picker 2.11.4 / datetimepicker 9.2.1 / segmented-control 2.5.7（SDK 58 自带版本）。spike（findings.md「6.3 spike」）：滑块几何、滚轮列 hitTest、慢拖 + 停留无惯性、DatePicker 停稳后才更新 date、iOS / Android 无障碍动作路径 |
| 6.3 原生 | ✅ | iOS：`sliderInfo`、`wheelInfo`（列触摸范围 hitTest、选中行 / 行高 / 标题、date / mode、moving）、`accessibilityAction`（increment / decrement / magicTap / escape / 自定义动作）；Android：`sliderInfo`（SeekBar）、`accessibilityAction`（先取节点信息，标准名映射 + 自定义 id 按序号）。两端 dev client 重建 |
| 6.3 代码 + 单测 | ✅ | protocol（setValue / adjustSlider / accessibilityAction、ControlValue / DateValue、HostInput select / fill）；fiber-adapter（`findProps`、`findHostlessComposites`）；agent `actions/value.ts`（按 props 形状识别控件、DOM 控件、容器内唯一控件、js 档位）、`actions/wheel.ts`（selectRow、selectDate 逐列探测单位）、三档位 performer、runtime（setValue 无宿主回退、accessibilityAction 不要求可见）；core Driver 三个方法 + toControlValue；web provider select / fill。`pnpm run check` 406 测试、depcruise 0 违规 |
| 6.3 实跑 | ✅ | 示例新增值控件页 controls（backdoor openControls）+ values.feature（9 场景）。最终：iOS native 23 通过 + 1 按 tag 跳过（全量 24）；iOS js 21 + 1 跳过；Android native 24/24；Android js 22/22；Web 三视口各 24/24；Web js 22/22。日期滚轮约 5 s。临时 Metro 8083 已停止。修复见 Errors 表 |
| 6.4 计划 + spike | ✅ | HU 决定：示例加 RNGH（runOnJS，不加 reanimated）、不用地图、Web 桌面视口报 ACTION_NOT_SUPPORTED、加 multiTouch。spike 即三端实跑：多指注入三端可用，识别器激活阈值导致读数偏小 → lead-in 补偿（findings.md「6.4 spike」） |
| 6.4 原生 | ✅ | iOS QSTouchInjector `sendFingers` / `liftAllFingers`（N 个 UITouch + 多 finger HID）、Swift `multiGesture`；Android `multiGesture` + MultiTouch（多 pointer MotionEvent）；单指 gesture 保持原实现不变；两端 prebuild 重建 |
| 6.4 代码 + 单测 | ✅ | protocol（pinch / rotate / multiTouch、TimedPoint、HostInput touches、AgentConfig.gestures / GestureSlop）；agent `actions/multitouch.ts`（帧格式、framesForSequence、pinchGestures 含 lead-in 与自动分次、rotateGesture 圆弧采样）、三档位 performer（js 档位 ACTION_NOT_SUPPORTED）、runtime；core Driver pinch / rotate / multiTouch + 校验、toAgentConfig(config, gestureSlop)、DeviceProvider.gestureSlop（iOS / Android / Web 默认值）、Session 先建 provider；web CDP 多点触摸。`pnpm run check` 419 测试、depcruise 0 违规 |
| 6.4 实跑 | ✅ | 示例新增手势页 gestures（backdoor openGestures）+ gestures.feature（6 场景，@needs-touch @multi-touch，1 个 @ios）。全量：iOS native 29 通过 + 1 跳过（30）；iOS js 21 + 1；Android native 29 + 1；Android js 22/22；Web mobile / tablet 29 + 1；Web desktop（not @multi-touch）24/24；Web js 22/22。桌面视口执行手势给出明确 ACTION_NOT_SUPPORTED。临时 Metro 8083 已停止 |


- 6.5 计划：HU 确认（JSON 单参数启动参数、sync 覆盖每场景恢复、深链接冷启动不可行时降级为启动后 openUrl）。Phase 3 标记补改为 complete。下一步 spike。
| 6.5 spike | ✅ | ③ Web：Playwright 下页面无法真正 hidden（4 种方式 × 有头/无头 × 默认参数）→ ACTION_NOT_SUPPORTED。② Android dev client `__expo_url` 新格式冷启动进 playground（5.8 s，两种 linking API 都拿到）；iOS `-quiescoUrl` + 原生 OnCreate 交给 ExpoLinking subscriber（第一版在非主线程 init 崩溃 → main.async，4/4 通过，2.3 s）。① Android HOME / 启动器 intent、iOS 设置 App 与原生 suspend 均同 pid 往返，AppState 事件正确；后台时 frame-stable / timer 不空闲（Android）、iOS ~20 s 后挂起。④ Android pm clear 后 dev client 正常重连（23.8 s）。iOS dev client 重建 2 次。临时 Metro 8083 已停止；spikeSuspend backdoor 已删，lifecycleInfo backdoor 保留给示例 |
| 6.5 代码 + 单测 | ✅ | protocol（LAUNCH_PARAM_ARGS / URL、TRACKER_NAMES、agent 方法 configure / deviceInfo / suspend、DeviceInfo / AppStateName）；agent（decodeLaunchArgs、`quiesco.launchArgs()` + stub、AppDeps appState / windowInfo、SyncEngine.setSkipped：后台时 frame-stable / timer / native 视为空闲）；native（两端 getLaunchParams 加 args、iOS suspend + `-quiescoUrl` → ExpoLinking）；core（DeviceProvider 扩展、iOS / Android 实现、launch-args.ts、png.ts、device.ts DeviceApi、sync-api.ts SyncApi、Driver 状态守卫 APP_NOT_RUNNING / APP_IN_BACKGROUND + request()、Session relaunch / beforeScenario 恢复、server.agentConfig 可变）；web（storageState 保留、args 注入、webPathFor）。`pnpm run check` 452 测试、depcruise 0 违规（第一次 native 函数对照测试需加 suspend）|
| 6.5 实跑 | ✅ | 示例新增生命周期页 lifecycle（backdoor openLifecycle / 深链接 quiescotodo://lifecycle）+ lifecycle.feature（7 场景，后台场景 @native）。全量：Web mobile / tablet 35 + 2 跳过（37）；Web desktop（not @multi-touch）30 + 1；Web js 28 + 1；Android native 36 + 1；Android js 29/29；iOS native 36 + 1；iOS js 28 + 1。期间修复见 Errors 表（terminate 后 action 未快速失败）。两端 dev client 重建；临时 Metro 8083 已停止。`pnpm run check` 453 测试、depcruise 0 违规。文档：api.md（app.device / app.sync / launchArgs / 新错误）、platforms.md（各端实现表 + 注意事项）|
- 6.6 计划：HU 确认（撤销权限自动重启、离线混合方案、设备状态每场景恢复）。下一步 spike。
| 6.6 spike | ✅ | 旋转三端可行（iOS 原生 geometry 请求、Android user_rotation、Web 视口互换）；外观 / 语言需 App 不锁定（示例改 userInterfaceStyle automatic、iOS CFBundleLocalizations en/ja）；Android 字号 / 语言重建 Activity；iOS 语言靠 -AppleLanguages 重启；撤销权限仅 Android 杀进程；iOS simctl 写剪贴板后 App 读取弹「允许粘贴」→ 两端原生模块；Android svc 断网 NetInfo 感知且 adb reverse 不受影响；Web 各项可行。两端 dev client 重建 2 次；示例装 netinfo 12.0.1 / expo-clipboard 58.0.4；探针 backdoor 已删；Metro / mock 已停 |
| 6.6 批次 A 代码 + 单测 | ✅ | protocol（DeviceInfo 读回 colorScheme / fontScale / locale、agent 方法 setOrientation）；agent（settings 读回、readColorScheme 用新建 MediaQueryList、setOrientation handler）；native（iOS setOrientation：geometry 请求）；core（DeviceProvider setOrientation / setLocation / setPermission / setAppearance / setFontScale / setLocale / resetDeviceState；iOS：Dynamic Type 档位映射、locale 启动参数、恢复原值；Android：settings / uimode / set-app-locales / geo fix / pm，字号与语言变化及其恢复都重启 App；DeviceApi 六个方法 + 读回校验 + 每场景与会话结束恢复）；web（视口互换、emulateMedia、geolocation、权限、locale 新 context）。core 112、agent 269、web 20 测试 |
| 6.6 批次 A 实跑 | ✅ | 示例新增设备状态页 device（expo-location）+ device.feature（7 场景，字号 @native）。全量：iOS native 43 + 1 跳过（44）；iOS js 35 + 1；Android native 43 + 1（冷启动模拟器）；Android js 36/36；Web mobile / tablet 41 + 3；Web desktop（not @multi-touch）修正后 device.feature 6 + 1；Web js 34 + 2；device.feature 修正后 iOS / Android 各 7/7、Web mobile 6 + 1。期间问题见 Errors 表（Web 深色模式观察者效应、Android Activity 重建致 expo-router 失效、Google 位置精度对话框、模拟器 7 小时后过慢 → 经 HU 同意冷启动、示例恢复场景对桌面视口的错误断言）。两端 dev client 重建；临时 Metro 8083 已停止 |
| 6.6 批次 B 代码 + 单测 | ✅ | protocol（AgentConfig.network.offline、agent 方法 getClipboard / setClipboard）；agent（`sync/offline.ts` OfflineGate：新建 fetch / XHR / WebSocket 指向 `.invalid`，自身连接豁免，装在 network tracker 之前）；native（两端 getClipboard / setClipboard）；core（DeviceProvider setStatusBar / resetStatusBar / setNetwork / get・setClipboard；iOS simctl status_bar、剪贴板经 App（读回退 pbpaste）；Android demo mode、svc wifi / data、剪贴板经 App；DeviceApi setStatusBar（校验）/ setNetwork / clipboard，每场景恢复；Session 把 offline 合并进每次下发的 agent config）；web（route 中止 + CDP overrideNetworkState、navigator.clipboard、状态栏空操作；ws devDependency）。`pnpm run check` 492 测试、depcruise 0 违规 |
| 6.6 批次 B 实跑 | ✅ | 示例设备页加 NetInfo、请求、剪贴板读写；device.feature +6 场景（NetInfo 场景 @android @web）。device.feature：iOS 12 + 1 跳过、Android 13/13、Web 12 + 1。全量：iOS native 48 + 2（50）；iOS js（not @needs-touch）40 + 2；Android native 49 + 1；Android js 42/42；Web mobile / tablet 47 + 3；Web desktop（not @multi-touch）42 + 2；Web js 40 + 2。期间问题：Web `context.setOffline` 掐断 Quiesco 连接 → 改方案；NetInfo web 只听 connection change → 离线吞吐量 0（findings）。两端 dev client 重建；8082 / 3001 被别的项目占用 → 临时 Metro 8083（已停）、经 HU 停掉 stub |
- 6.7 计划：HU 确认（示例加 expo-notifications / expo-local-authentication、Android 推送走原生本地通知、iOS 系统弹窗先 spike XCUITest、Android clearKeychain 不支持）。下一步批次 A spike。
| 6.7 批次 A spike | ✅ | iOS Face ID：notifyutil 录入 / pearl.match 成功；nomatch 留系统重试弹窗。Android：Settings 录入流程可脚本化（uiautomator + emu finger touch），id 1 匹配成功，未录入 id 留系统提示；locksettings clear 恢复。keychain reset 作用于整台模拟器。HU 决定 ⑤⑥（findings「6.7 批次 A spike」）|
| 6.7 批次 A spike（续） | ✅ | shake：iOS SimulatorShake Darwin 通知（iOS 26.5 已无 _sendMotion*，原生方案撤销）、Android emu sensor 12 次翻转；均使 react-native-shake 计数 +1。示例加 react-native-shake、系统页摇动计数 |
| 6.7 批次 A 代码 + 单测 + 实跑 | ✅ | core：DeviceProvider setBiometricEnrollment / presentBiometric / shake / clearKeychain；iOS（notifyutil 录入 / 恢复原值、pearl+fingerTouch、SimulatorShake、keychain reset）；Android（Settings 录入状态机：PIN、按位置找主按钮、emu finger touch，PIN 清除即撤销；match/fail 等认证 STARTED 且失败后冷却 1 s；emu sensor 12 次翻转；仅模拟器）；DeviceApi biometrics.enroll/match/fail、shake、clearKeychain（Android ACTION_NOT_SUPPORTED + 提示）。示例 system.feature（5 场景，@native，不匹配场景 @android）：iOS 5/5、Android 5/5。经 HU 同意冷启动模拟器 |
| 6.7 批次 A 全量回归 | ✅ | 首轮 iOS native 6 失败（摇动打开 dev 菜单，见 findings）→ 启动参数关闭 dev 菜单摇动手势后 iOS native 53 + 2（55）。其余首轮即通过：iOS js（not @needs-touch）45 + 2；Android native 54 + 1；Android js 47/47；Web mobile / tablet 47 + 8；Web desktop（not @multi-touch）42 + 7；Web js 40 + 7。iOS 固定 26.5 模拟器（另一项目占用 iOS 27 同名机），Metro 8083 |
