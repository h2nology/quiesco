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
  - 测试：常量完整性 4 个 + 类型测试 7 个（vitest typecheck 模式，`@ts-expect-error` 实际生效）。
- 1.3 agent 底层完成（从 spike 代码整理）：
  - `fiber-adapter/`：hook（包装/自装、幂等、渲染器校验、装得太晚检测 lateRenderers + checkRendererSeen）、scheduler 补丁（检测 B）、FiberRoot 字段（检测 A）、traverse（HostNode 树、文本/ownText、Singleton 透明、Hoistable 跳过、scope）、host（native / web 平台差异、样式隐藏、取坐标、视口）、default-deps(.native).ts。
  - `query/`：Matcher（id/text/label/role/within/index，text 取最深匹配）、resolveOne（ELEMENT_NOT_FOUND / MULTIPLE_MATCHES）、可见性规则、summarize / getTree / structureHash。
  - `sync/`：network、timer、react、idle-callback（含旧版 InteractionManager）、frame-stable、SyncEngine（两次确认、超时列出 describeBusy）。`errors.ts`：QuiescoError。
  - 修正：首次测试 2 处失败都是测试代码问题（spy 引用被包装覆盖、fake setTimeout 丢参数）；lint 的 no-this-alias 配置为允许 `self`。

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
