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
