# Task Plan: Quiesco —— Expo 用 E2E 灰盒测试工具（iOS / Android / Web，Cucumber 驱动）

## Goal
按 `requirements.md` 第 10 节的 6 个阶段，交付 Quiesco monorepo：三端灰盒同步 + Cucumber 驱动，示例 App 的第 9 节场景在 iOS Simulator、Android Emulator、Chromium 上用同一份 feature 通过。

## Next Step
6.5 完成并提交（c5a4200）。6.6 批次 A 已提交（b899531）；6.6 批次 B 完成并提交（2026-11-09，三端全量实跑通过）⇒ 6.6 完成。6.7 计划 HU 已确认（2026-11-09）；6.7 批次 A（生物识别 / shake / clearKeychain）完成并提交（2026-11-10，三端全量通过）。6.7 批次 B（推送：sendNotification / openNotification）完成并提交（2026-11-10，三端全量通过；iOS openNotification 待批次 C）。6.7 批次 C Android 部分（app.device.system.*、agent 后台等待修复）完成并提交（2026-11-10，三端全量通过）；Web dialog 延后（HU）。下一步：iOS XCUITest 辅助进程 spike（iOS 通知点击 / 通知授权 / Face ID 重试弹窗），spike 后请 HU 决定是否实现。平台标签改为「最内层带平台标签的层级决定」（HU 2026-11-10 确认；三端全量通过并提交）。

## Current Phase
Phase 6

## 工作约定（摘自 requirements.md §12，每个阶段都要遵守）
- 按阶段推进，不跳阶段；每阶段开始前先输出实施计划，经确认后再写代码。
- 对 React / RN / Expo 内部 API 不确定时，先查当前官方文档或源码，不凭记忆实现。
- Fiber 字段访问只能在 `packages/agent/src/fiber-adapter/`。
- 平台分支只允许在 fiber-adapter、存储适配器、各 DeviceProvider 中。
- `core` 不依赖 `@cucumber/cucumber`、`playwright` 或任何运行器（CI 用 dependency-cruiser 检查）。
- Web 端只用 `playwright` 库，禁止 `@playwright/test`。
- 测试与示例 step 中禁止 sleep / 固定时长等待。
- 每个包有单元测试；tracker 逻辑必须有单元测试。
- 宣称阶段完成前，实际运行验收测试并展示结果。
- §11 的待确认事项一律暂停询问 HU，不自行假设。

## Phases

### Phase 0: 技术验证（spike）
产出：`docs/spikes/` 下 7 份结论文档；1〜5、7 附带可运行验证代码（放在 `spikes/` 下，不进入正式 packages）。

- [x] 0.0 环境盘点：Node LTS、pnpm、Xcode/simctl、Android SDK/adb/AVD、当前最新稳定 Expo SDK 版本与默认架构（查官方文档），记录到 findings.md
- [x] 0.1 搭建 spike 用 Expo App（`spikes/spike-app/`，New Architecture，dev client，含本地 Expo Module 骨架）
- [x] S1 Fiber 查询（原生）：DevTools hook 取 renderer/根 Fiber → 按 testID 找宿主组件 → 取屏幕坐标（Fabric 下的 measure 等价 API）→ `docs/spikes/01-fiber-query.md`
- [x] S2 React 空闲检测：找到判断「无待提交渲染」的可靠方法（调度器状态 / commit hook 等，对照 React 源码）→ `docs/spikes/02-react-idle.md`
- [x] S3 Android 触摸注入：MotionEvent + `Activity.dispatchTouchEvent`，验证 onPress、Pressable 按下态、RNGH 点击 → `docs/spikes/03-android-touch.md`
- [x] S4 iOS 触摸注入：合成 UITouch/UIEvent（参考 KIF）点击 RN 按钮；失败则记录原因 + 替代方案，**交 HU 决定**（§11-3）→ `docs/spikes/04-ios-touch.md`
- [x] S5 连接参数传递：比较启动参数 / 深链接 / 构建期注入，三端各自验证 → `docs/spikes/05-connection-params.md`
- [x] S6 生产剔除：原生与 Web 生产构建中 agent 与原生模块完全剔除的方案（环境变量 + tree-shake + config plugin 条件注入）→ `docs/spikes/06-prod-strip.md`（只需结论，可附验证）
- [x] S7 Web 端 Fiber 查询：react-dom + react-native-web 下同一 fiber-adapter 接口按 testID 找宿主 DOM 节点并取坐标，确认 testID 映射 → `docs/spikes/07-web-fiber-query.md`
- [x] 0.9 汇总：给出最低支持 Expo SDK 版本建议（§11-2，交 HU 决定）、Expo Go / JS-only 可行性结论、对第 1 阶段设计的影响
- **验收：** 7 份结论文档；1〜5、7 的验证代码可运行 ✅（另有汇总 `docs/spikes/00-summary.md`）
- **Status:** complete

### Phase 1: 核心闭环（Android + JS 档位）
**范围**：monorepo 骨架、`protocol`、`agent`（Query、全部 tracker、JS 档位动作、断言）、`core`（WS Server、Driver、会话 API、Android DeviceProvider）、`cucumber` 接线、示例 App 与第 9 节 feature。目标 SDK 58。

**任务拆分（按顺序）**
- [x] 1.1 骨架：pnpm workspaces（`.npmrc` 用 `node-linker=hoisted`，兼容 Metro / autolinking）、TS strict 共用 tsconfig + project references、ESLint、Vitest、dependency-cruiser 规则（core 不得依赖 cucumber / playwright / web；只有 fiber-adapter 可以 import 渲染器私有路径）、GitHub Actions（lint / typecheck / test / depcruise）
- [x] 1.2 `@quiesco/protocol`：JSON-RPC 2.0 消息类型、方法与参数类型（hello / query / action / assert / waitForIdle / getTree / reset / backdoor / getIdleState）、事件（log / error）、错误码枚举、`PROTOCOL_VERSION`、Matcher 类型
- [x] 1.3 `@quiesco/agent` 底层：
  - `fiber-adapter/`：hook 安装/包装、渲染器校验、遍历、宿主判定（testID / data-testid）、文本、props、取坐标（Fabric 实现；Web 实现留到 Phase 3）、「装得太晚」检测
  - `query/`：Matcher（id / text / label / role / within / index）、可见性判定、getTree 精简 JSON
  - `sync/`：IdleTracker 接口 + network（fetch / XHR，ignoreUrls）、timer（≤ 阈值）、react（A&&B，scheduler 替换）、idle-callback（rIC + 旧版 InteractionManager 兼容）、frame-stable（结构哈希 N 帧）；`waitForIdle` 跨宏任务两次确认、超时时列出 describeBusy
  - 单元测试：所有 tracker、Matcher、waitForIdle（fake timers / fake root / fake scheduler）
- [x] 1.4 `@quiesco/agent` 上层：WS 连接（hello、重连）、JS 档位动作（tap / longPress / doubleTap → onPress 等；type / clear → onChangeText；scroll / scrollTo / swipe 的 JS 实现；dismissKeyboard）、断言（expectVisible / NotVisible / Exists / NotExists / Text / Prop / Count，在 agent 端反复检查直到超时）、`QuiescoRoot`（安装 tracker、根 key）、`withQuiesco`（Metro：非 e2e 替换为桩；注入构建期兜底端口的虚拟模块）、`stub` 入口
- [x] 1.4b 后门与软重置的**最小实现**（HU 2026-11-07 决定提前）：`quiesco.backdoor()` 注册与调用（JSON 可序列化校验、未注册时列出已注册名称、执行后等待空闲）、`quiesco.onReset()`、软重置（清 AsyncStorage → onReset 钩子 → 根 key 更换 → 等待空闲）
- [x] 1.5 `@quiesco/core`：WS Server（多连接、session 校验、协议版本检查）、会话 API（运行器无关：createSession / beforeScenario / collectEvidence / dispose）、Driver（6.3〜6.6 的 async API）、DeviceProvider 接口 + Android 实现（boot：唤醒/stayon；install；launch：pm grant、adb reverse、am start 带 extras 与 dev client URL；terminate；screenshot；shutdown）、`defineConfig` 与配置加载、连接等待超时与排查提示
- [x] 1.6 `@quiesco/cucumber`：World（`this.app`）、hooks（BeforeAll / Before / After / AfterAll）、`register` 入口
- [x] 1.7 `examples/todo-app`：Expo SDK 58 + Expo Router（登录页、待办列表、新建待办表单、带动画的页面切换）、本地 mock server（可配置延迟）、`features/` 第 9 节 feature + step definitions、`quiesco.config.ts`
- [x] 1.8 验收：
  - Android Emulator + dev client 上第 9 节场景全部通过
  - 给 mock server 加 2 秒延迟、给页面切换加 1 秒动画后，不改测试仍稳定通过
  - 人为制造同步超时，错误信息能指出未完成的请求 / 定时器

**文件清单（主要）**
```
package.json  pnpm-workspace.yaml  .npmrc  tsconfig.base.json  eslint.config.js  .dependency-cruiser.cjs  vitest.workspace.ts
.github/workflows/ci.yml
packages/protocol/src/{index,messages,methods,errors,matcher}.ts
packages/agent/src/index.ts  stub.ts  metro.ts
packages/agent/src/fiber-adapter/{index,hook,traverse,host,measure,types}.ts  (+ renderer shim 类型声明)
packages/agent/src/query/{matcher,visibility,tree}.ts
packages/agent/src/sync/{tracker,network,timer,react,idle-callback,frame-stable,wait-for-idle}.ts
packages/agent/src/actions/js/*.ts  assertions/*.ts  connection/*.ts  root/QuiescoRoot.tsx
packages/agent/test/**/*.test.ts
packages/core/src/{index,config,session,driver,errors}.ts  server/ws-server.ts  devices/{provider,android}.ts
packages/core/test/**/*.test.ts
packages/cucumber/src/{register,world,hooks}.ts
examples/todo-app/{app/**, mock-server/**, features/**, quiesco.config.ts, metro.config.js}
```

**验收**：Android Emulator + dev client 第 9 节场景通过；注入 2s 网络延迟与 1s 动画后无需改测试仍稳定通过；同步超时错误能指出具体请求/定时器
- **Status:** complete

### Phase 2: 真实触摸与速度（Android）
**范围**（requirements.md §10 第 2 阶段）：`@quiesco/native` Android 实现 + `native` 动作档位、性能基准。已在 Phase 1 提前完成：软重置 / 后门 / onReset（1.4b）、失败时截图与元素树（1.6）。iOS 实现、完整 expo-plugin、并行留给 Phase 4。

**任务拆分（按顺序，计划待 HU 确认）**
- [x] 2.0 小型验证（结论写入 findings）：① JS 传 `__nativeTag`，原生 `resolveView(tag)` + `getLocationInWindow` 取真实坐标（含 native driver 动画）；② RN `Modal`（独立 Dialog 窗口）：在目标 View 的 `rootView` 上 dispatch；③ `InputConnection.commitText` 向 TextInput 输入中文，`onChangeText` 是否触发；④ `WindowInspector.getGlobalWindowViews()`（API 29+）判断目标窗口是否被更上层窗口遮挡
- [x] 2.1 `packages/native`（`@quiesco/native`，Expo Module，Android）：`getLaunchParams`；`tap(tag|point, holdMs, count)`、`longPress`、`swipe(from, to, durationMs)`（DOWN→MOVE×n→UP，用于 scroll / swipe）、`typeText(tag, text)` / `clearText(tag)`（先点击聚焦，再通过 InputConnection）；在目标 View 所在窗口注入；dp↔px 换算；iOS 侧只放会报「未实现」的桩
- [x] 2.2 `@quiesco/native` 自带 `app.plugin.js`：非 e2e prebuild 时从 autolinking 排除（S6 方案）；e2e 时加入只放行 localhost / 127.0.0.1 的 network security config（S5 建议）。完整 expo-plugin（iOS、eas profile、CI 生产检查）仍在 Phase 4
- [x] 2.3 agent：经可选依赖（`try` 内 require）检测 `@quiesco/native`，hello 报 `nativeModule: true`、优先读原生启动参数（native 构建不再走匿名 session）；`actions/native.ts`：注入前要求元素可见且连续 2 帧位置不变、命中检查（该点最上层宿主元素是目标或其后代，否则报「被 X 遮挡」）、tap / longPress / doubleTap / type / clear / scroll / swipe / scrollTo；fiber-adapter 暴露 `HostNode.nativeHandle()`（= `__nativeTag`）
- [x] 2.4 core / cucumber：`actions.mode` 未配置时按 hello 自动选 native；无需其他协议变更
- [x] 2.5 示例 App：加入 `@quiesco/native` 与 plugin，重建 APK；配置去掉 `mode: 'js'`（自动选择）；新增一个用 RN `Modal` 的场景（删除确认等）验证弹窗内注入；第 9 节场景在 native 档位通过，js 档位也保留可运行
- [x] 2.6 性能基准脚本（`examples/todo-app/bench/`）：软重置耗时、单次 tap（含同步）往返、全量测试耗时；native / js 两档；结果与设备信息写入 `docs/benchmarks.md`
- [x] 2.7 验收：native 档位第 9 节场景通过；连续 20 次无随机失败（记录每次结果与耗时）；基准在案；`pnpm run check` 通过
- **顺带处理（Phase 1 遗留）**：同步超时信息里显示的是剩余时间（如 9881ms）→ 改为同时显示动作的总超时；AVD 名称识别不出时会重复启动 emulator → 改为先检查同名 AVD 是否已有 qemu 进程
- **验收：** native 档位通过；连续 20 次无随机失败；基准记录在案
- **Status:** complete（2026-11-07）

### Phase 3: Web
**范围**（requirements.md §10 第 3 阶段）：`@quiesco/web`（Web DeviceProvider、Playwright 输入注入、静态文件服务器含 SPA 回退）。已提前完成：react-dom 版 fiber-adapter（1.3 / S7）、Web 存储适配器（1.4b）、平台 tag 过滤与 `QUIESCO_PLATFORM`（1.6）；`--platform` CLI 属于 Phase 5。

**HU 决定（2026-11-08）**：§11-6 只验收 Chromium；§11-7 手机 / 平板 / 桌面三个视口都验收（第 9 节场景三视口都通过，20 次稳定性每个视口各 20 次），默认手机。视口尺寸写在示例 App 的 quiesco.config（§6.13 不写死在代码里），`QUIESCO_VIEWPORT` 切换。

**任务拆分（计划待 HU 确认）**
- [x] 3.1 `packages/web`（`@quiesco/web`）：`WebProvider implements DeviceProvider`，`playwright` 为 peer 依赖。boot = 启动浏览器；install = 启动静态服务器（`apps.web.distDir`，SPA 回退到 index.html）或检查 `apps.web.url` 可访问；launch = 新 browser context（视口、权限映射）+ `addInitScript` 注入 `window.__QUIESCO__` + `goto`；terminate = 关闭 context（硬重置即新 context）；screenshot = `page.screenshot`；injectInput = Playwright 鼠标 / 键盘 / 滚轮 / 导航 / 后退；shutdown = 关浏览器和静态服务器
- [x] 3.2 core：`createProvider('web')` 运行时动态 import `@quiesco/web`（core 不依赖它，depcruise 规则不变）；未安装时给出安装提示；配置类型补全 `apps.web` / `devices.web`
- [x] 3.3 Web 的 `native` 档位 = Host 注入：agent 在没有 `@quiesco/native` 时，native 档位不报错，而是做完可见 / 稳定 / 命中检查后返回 `hostInput`（tap / type / wheel），由 Driver 交给 provider 注入后再等空闲（agent 内不按平台分支；Android 无原生模块时 provider 不支持 tap 注入 → 明确报错）。协议新增 `HostInput` 的 `wheel`（Web 上滚动用滚轮，鼠标拖动不会让 RNW ScrollView 滚动）
- [x] 3.4 整页刷新后透明重连（§6.2）：Driver 发现连接已断开时，先等待同一 session 的新连接（连接超时内），再继续当前调用；与平台无关
- [x] 3.5 示例 App 的 Web：`web.output` 用 `static`（顺带验证 Expo Router 静态渲染的 hydration：QuiescoRoot 挂载后才连接，Host 等连接 = 等 hydration 完成）；`build:web`（e2e 静态导出）、`test:e2e:web`；quiesco.config 加 `apps.web` / `devices.web`；开发服务器方式也跑一次
- [x] 3.6 「只测原生端不装 Playwright 也能运行」的验证：用 Node 的 module hook 在加载 `playwright` / `@quiesco/web` 时直接抛错，带着它跑一次 Android 全量 feature
- [x] 3.7 验收：同一份 feature 与 step 在 Android Emulator 与 Chromium（手机 / 平板 / 桌面三视口）上都通过；Web 每个视口连续 20 次无随机失败；3.6 通过；`pnpm run check` 通过
- **Status:** complete（验收记录见 progress.md 3.6 / 3.7；标记于 2026-11-09 补改）

### Phase 4: iOS 与 Expo 集成
**范围**：`@quiesco/native` iOS 实现、iOS DeviceProvider、`@quiesco/expo-plugin`（从 native 包迁出并补 iOS）、`eas.json` e2e profile、生产剔除检查、cucumber `--parallel`。环境：Xcode 27.2，iPhone 17 / iOS 27.0（另有 iOS 26.5 runtime）。

**任务拆分（按顺序）**
- [x] 4.0 原生验证（spike 未覆盖的 4 项，临时代码，结论记 findings）：① Fabric 下 view tag → `UIView`（`RCTComponentViewRegistry` / `RCTSurfacePresenter`）与窗口坐标；② Modal（同一窗口内 present 的 VC）遮挡判定：目标点 `hitTest` 结果是否是目标 view 的子孙；③ 中文输入：聚焦后 `UITextInput insertText:` / `replaceRange:` 触发 onChangeText；④ swipe / 滚动：Moved 阶段 HID 事件 + ScrollView 惯性；⑤ 进程内 openUrl（不经 `simctl openurl`，避免 SpringBoard 确认框）
- [x] 4.1 `@quiesco/native` iOS：Swift Module + ObjC `QSTouchInjector`（私有 API 调用前 `respondsToSelector:` 检查，不满足报 `NATIVE_UNSUPPORTED` 并建议 js 档位）；与 Android 相同的 JS 接口：`getLaunchParams` / `locate` / `tap` / `swipe` / `typeText`，新增 `openUrl`；`expo-module.config.json` 加 `ios`；podspec 链接 IOKit
- [x] 4.2 agent：坐标无需平台分支（原生侧直接返回窗口坐标 pt / dp）；`openUrl` 在原生模块具备 `openUrl` 能力时于 App 内打开（按能力判断，不按平台）；`pressBack` 仍交给 Host，由 4.4 的 iOS provider 报 `ACTION_NOT_SUPPORTED` 并提示改用业务返回操作（§12：平台分支留在 provider）
- [x] 4.3 `@quiesco/expo-plugin`：把 `packages/native/app.plugin.js` 迁入并补 iOS ——非 e2e：Podfile 注入 `use_expo_modules!(exclude: ['@quiesco/native'])`；e2e：确认 ATS `NSAllowsLocalNetworking`；dev client 启动参数常量共用。示例 App 改用 `"@quiesco/expo-plugin"`；单元测试覆盖两种模式的 Podfile / settings.gradle / manifest 结果
- [x] 4.4 core `IosProvider`（`xcrun simctl`）：按名称 / UDID / runtime 选模拟器，`boot` + `bootstatus -b`；`install` .app；`launch` 用进程参数 `-quiescoPort/-quiescoSession`，dev client 用 `--initialUrl`（带 `__expo_disable_onboarding/fab/auto_launch`）；`terminate`、`privacy grant` 权限映射（不支持的给警告）、`io screenshot`、硬重置（terminate + 清 App 容器 / 重装）；连接超时诊断。单元测试用假 exec 校验命令
- [x] 4.5 示例 App：`ios` 配置与 `build:ios`（simulator Debug dev client）/ `test:e2e:ios` 脚本；`eas.json` 的 `e2e` profile（iOS simulator build、Android APK、`EXPO_PUBLIC_QUIESCO=1`）
- [x] ~~4.6 cucumber `--parallel`~~（2026-11-08 HU 撤销并已回退；保留对串行也有效的修复：冷启动 `-no-snapshot-load`、install 前 force-stop、native LaunchParamsStore）
  - 4.6a core：provider 收 `workerIndex`。iOS：`udids[]` > worker 0 用 base / N>0 用 `"<base> (Quiesco N)"`（无则 `simctl create` 同 device type + runtime，保留复用；`simctl clone` 要求源设备关机，不可用）；Android：`serials[]` > `avd` 时 worker N 绑定 `emulator-(5554+2N)`（`-port`，全部实例 `-read-only` + 冷启动 `-no-snapshot-load`）> 第 N 台在线设备（不足报错）；Web 无需改动
  - 4.6b 协议：hello 返回的 config 加可选 `workerIndex`，agent 暴露 `quiesco.workerIndex`；quiesco.config 可写成 `({ workerIndex }) => config`；示例 mock 后端 3001+N，App 在 e2e.ts 据 workerIndex 切 API 地址，Android `reversePorts: [3001 + workerIndex]`
  - 4.6c 示例 `test:e2e:*:parallel` 脚本、README 并行一节；验收：三端 `--parallel 2` 6 场景通过 + 串行回归 + `pnpm run check`
- [x] 4.7 生产剔除检查脚本 `scripts/check-prod-strip.mjs`：生产模式 `expo export --platform all` 后在 JS / Hermes 字节码中 grep agent 特征串；iOS Release simulator 构建后 `nm` 查 `QSTouchInjector`、`IOHIDEventCreateDigitizerEvent`；Android release APK 查 `QuiescoNative`（R8 不混淆的 Module 名）；带 e2e 对照组。接入哪个 CI 由 §11-4 决定
  - **HU 确认（2026-11-08）**：本机在原目录跑（已有 android/ios 时需 `--allow-clean`，跑完重建 e2e dev client）；CI 新增 `prod-strip.yml`（web / android ubuntu、ios macos；push main + 相关路径 PR + 手动），不进 ci.yml；扫描逻辑 `scripts/prod-strip/scan.mjs` + vitest 单元测试
- **HU 决定（2026-11-08，4.8 中）**：三端都去掉 `--parallel` 支持（Android 串行保持可写启动）；保留 4.6 中对串行也有效的修复（`-no-snapshot-load`、install 前 force-stop、native LaunchParamsStore）；cucumber `--parallel` 时明确报错。HU 确认回退计划并要求同步修改 requirements.md（§6.9、第 4 阶段范围与验收：并行验收改为 iOS 连续 20 次）。偶发失败：18 次复现未果，HU 决定把探针转为正式诊断（frame-stable 超时报告采样帧数 / 耗时与首个变化节点）。
- [x] 4.8 验收（按 HU 2026-11-08 修改后的标准）：iOS / Android / Chromium 三端串行 6 场景通过；iOS 连续 20 次 20/20；生产剔除检查通过（含对照组，4.7）；结果记入 `docs/benchmarks.md`；`pnpm run check`
- **验收：** 三端串行通过；iOS 连续 20 次无随机失败；生产构建检查通过 ✅（并行验收已随需求撤销）
**HU 决定（2026-11-08）**：§11-4 GitHub Actions（再次确认；iOS 检查跑 macos runner）；并行验收三端都实测（含本机同时运行两台 Android Emulator）。
- **Status:** complete（2026-11-08）

### Phase 5: 易用性与周边
**HU 决定（2026-11-08）**：① 验收时用 `pnpm pack` 的 tarball 本地安装，README 按发布后的 `npm i -D quiesco …` 写并附「从源码使用」；② 目标被键盘遮挡时**自动收起键盘**再执行动作；③ steps 包提供中 / 日 / 英三种语言的步骤；④ 许可证 MIT（§11-1）。

- [x] 5.0 Phase 4 遗留：「agent loaded after the React renderer」——真问题（release e2e 构建不可用），已修根因（agent early 模块由 withQuiesco 在 RN setup-env 之前执行）
- [x] 5.1 CLI 包 `quiesco`（`packages/cli`）：`test`（透传 cucumber-js）、`doctor`（环境与项目接入检查，✅/⚠️/❌ + 修复提示）、`tree`（起 server 等运行中的 App 重连后打印元素树，`--launch` 由 provider 启动）、`init`（依赖、plugin、metro、入口 import、配置、features 示例；不覆盖已有文件）；单元测试；depcruise：cli 不静态依赖 cucumber
- [x] 5.2 权限与键盘：权限映射表文档 + 示例 App 授权场景；动作目标被键盘遮挡时自动收起键盘后再执行（三端），单元测试 + 实机
- [x] 5.3 `@quiesco/steps`：`registerQuiescoSteps()`，中 / 日 / 英三套步骤文本；文档注明只适合原型期（§6.11）
- [x] 5.4 文档：根 README（快速开始、MIT）、`LICENSE`、`docs/`（API 参考、同步机制、三端差异、故障排查、Driver 模式、CLI、steps）
- [x] 5.5 验收：全新 create-expo-app（SDK 58）按 README 操作计时 ≤ 10 分钟跑通首个场景（Web；时间允许再 Android）；`pnpm run check`
- **验收：** 全新 create-expo-app 项目按 README 10 分钟内在任一平台跑通首个场景
- **Status:** complete（2026-11-08）

### Phase 6: 动作与设备能力超越 Detox
**HU 要求（2026-11-08）**：把相对 Detox 缺少的能力全部补上，能优化的再优化，目标是功能比 Detox 全、体验比 Detox 好。
**HU 决定（2026-11-08）**：① 重新做并行（6.12）；② iOS 系统弹窗先 spike XCUITest 辅助 runner 再定；③ 做真机（6.13）和 Pilot 类 LLM 驱动（6.14）；④ 按编号顺序执行，每个子阶段三端实跑后提交。
**对标基线**：Detox 20.51.4（findings.md「调研 B」）。**原则**：Detox 里单平台独占的能力，Quiesco 尽量三端都做（做不到的写进 platforms.md 并报 ACTION_NOT_SUPPORTED + 原因）；每项能力都要有单元测试 + 示例 App 三端实跑；Detox 的已知痛点逐条对应一个可验证的改进。

- [x] 6.0 调研：Detox API 全集与痛点、Quiesco 动作链路 → findings.md（调研 A / B）
- [x] 6.1 Matcher 与断言扩充（纯 JS，agent + core）——详细计划（2026-11-09），完成（2026-11-09）
  - **protocol**：`Matcher` 加 `id: TextMatch`（可正则）、`type?: SemanticType | string`（语义类型或宿主类名）、`has?: Matcher`（子孙中有匹配，= withDescendant）、`not?: Matcher`（自身不满足）；`AssertionSpec` 加 `visible{ratio?}`、`focused` / `notFocused`、`enabled` / `disabled`、`checked` / `notChecked`、`value{expected}`、`label{expected}`；`ElementSummary` 加 `semanticType`、`focused`、`enabled`、`checked?`、`value?`、`visibleRatio`
  - **fiber-adapter**（平台差异只在这里）：`HostNode` 加 `isFocused()`（native：`TextInputState.currentlyFocusedInput()` 与 public instance 比较；web：`document.activeElement`）、`ownerNames()`（拥有该宿主的复合组件名，用于语义类型，如 Pressable / Slider）、`clipRect()`（滚动容器 / overflow 裁剪：native 按 ScrollView 宿主类型，web 按 computed overflow）
  - **query 层**：`semanticType(node)` 映射表（宿主类名 + role + 复合组件名 → button / input / text / image / switch / slider / scroll / list / picker / progress / checkbox / link / header），**映射表按三端实机 `quiesco tree` 输出核对后定稿**；`state(node)` 统一读 enabled（disabled / accessibilityState.disabled / aria-disabled / editable=false）、checked（accessibilityState.checked / aria-checked / Switch value）、value（TextInput `text` prop / Slider / Switch / accessibilityValue）；`visibleRatio(node)` = 可见面积 / 自身面积（视口 ∩ 祖先裁剪框）
  - **可见性规则升级**：可见判定增加祖先滚动容器裁剪（目前只看窗口），默认仍是「任一像素可见」；`expectVisible(t, { ratio: 0.75 })` 可选比例（Detox 默认 75% 且不可关）
  - **core Driver**：`expectFocused` / `expectNotFocused` / `expectEnabled` / `expectDisabled` / `expectChecked` / `expectNotChecked` / `expectValue` / `expectLabel`、`expectVisible(t, { ratio })`、`attributes(t)`（唯一元素的完整 ElementSummary，多个时报 MULTIPLE_MATCHES）；`ElementQuery` 对应字段（`id` 可 RegExp、`type`、`has`、`not`）
  - **测试**：agent 单测（各语义类型映射、state 读取、has / not / id 正则、裁剪与比例、焦点）；core 单测（toMatcher、新断言参数）；示例 App 增加一个表单 feature 覆盖焦点 / 禁用 / 勾选 / 值 / 类型匹配，三端实跑；`pnpm run check`
  - **文档**：api.md Matcher 与断言表、visibility 规则、语义类型三端映射表；steps 新增对应中日英步骤留到 6.10 统一做
  - **HU 决定（2026-11-09）**：① 祖先滚动容器裁剪加入可见判定并默认生效（三端全量回归）；② 在现有 `expectXxx` 之外再加链式 API `app.expect(t).not.toBeFocused()`（类 Detox / Jest，便于迁移），两套写法共用同一实现
- [x] 6.2 元素动作补全（第一批，单指）——详细计划（2026-11-09），完成（2026-11-09）
  - **原生模块（需重建 iOS / Android dev client）**：新增 `gesture(tag, path, ...)`——单指按时间的路径（`[x, y, tMs]` 列表，窗口坐标，在 tag 所在窗口注入），覆盖「按住后拖动」「指定点点击 / 长按」「指定起点的滑动」，为 6.4 多指留出扩展；新增 `pressKey(tag, key)`：iOS `insertText("\n")`（回车 → onSubmitEditing，**spike 先验证**）/ `deleteBackward()`，Android `InputConnection.performEditorAction(imeOptions)` / `sendKeyEvent(KEYCODE_DEL)`；现有 tap / swipe / typeText 不变
  - **protocol**：ActionSpec 加 `tap{point?}`、`multiTap{count}`（doubleTap 保留 = count 2）、`longPress{point?}`、`replaceText{text}`、`pressKey{key: 'enter'|'backspace'}`、`scroll{from?}`、`scrollToEdge{edge}`、`scrollToIndex{index, viewPosition?}`、`swipe{distance?, from?}`、`drag{to: Matcher | {x,y}, holdMs?, speed?}`、`tapAt{x,y}` / `longPressAt{x,y,durationMs?}`（窗口坐标，不按元素）；HostInput 复用现有 tap / drag / key / wheel
  - **坐标约定**：`point` = 元素内坐标（逻辑像素，与 Detox `tap(point)` 相同）；`from` = 元素内归一化起点 0–1（与 Detox normalizedStartingPoint 相同）；`distance` = 逻辑像素；点不在元素内时报参数错误
  - **三种档位**：
    - native：gesture / pressKey 原生实现；scrollToEdge = 反复拖动直到偏移不再变化
    - host（Web 真实输入）：tap / drag / key / wheel HostInput；scrollToEdge = 反复 wheel
    - js：tap point → 按点 hitTest 后调最近的 onPress；multiTap = n 次 onPress；replaceText = onChangeText(text)；pressKey enter → onSubmitEditing、backspace → onKeyPress + onChangeText；scrollToEdge = ScrollView `scrollTo` / `scrollToEnd`；drag → ACTION_NOT_SUPPORTED（说明：拖拽依赖手势识别，请用 native 档位）
    - `scrollToIndex` 三档相同：调用列表实例的 `scrollToIndex`（FlatList / SectionList 用 scrollToLocation / FlashList），之后等待空闲并确认目标行已渲染；越界、行高未知（onScrollToIndexFailed）给出明确错误——Detox 只支持 Android
  - **Driver**：`tap(t, { point })`、`multiTap(t, n)`、`longPress(t, { point, durationMs })`、`replaceText`、`pressKey(t, key)`、`scroll(t, dir, { distance, from })`、`scrollToEdge(t, edge)`（实施时改为独立方法：`scrollTo(list, 'bottom')` 中 'bottom' 也可能是 testID，有歧义）、`scrollToIndex(list, i, { viewPosition })`、`swipe(t, dir, { speed, distance, from })`、`drag(t, { to, holdMs, speed })`、`tapAt({x,y})`、`longPressAt({x,y}, { durationMs })`
  - **示例 App**：新增隐藏的「能力演示」页 `playground`（backdoor 打开；6.3 起继续扩充），本阶段放：记录点击坐标的区域、连击计数器、长按后可拖动的方块（PanResponder）与两个放置区、回车提交的输入框、200 行 FlatList；`features/actions.feature` 覆盖以上动作；新建待办的标题框加 onSubmitEditing（回车保存）
  - **测试**：agent 单测（三档位各动作、坐标换算、scrollToEdge 循环、scrollToIndex 失败分支）；core 单测（参数转换）；三端实跑（iOS / Android 真实触摸 + js 档位各一次、Web 三视口）；`pnpm run check`
  - **文档**：api.md 动作表、坐标约定、各档位支持表；platforms.md 差异
  - **HU 决定（2026-11-09）**：① 原生新增 gesture / pressKey 并重建两端 dev client（iOS 回车先实验确认）；② 原生实跑时临时在空闲端口起干净 Metro（--clear）、用 QUIESCO_METRO_URL 指向、跑完立即停掉，不碰 8082；③ 示例 App 新增隐藏的 playground 页（backdoor 打开），后续子阶段的测试控件都放这里
- [x] 6.3 值控件与无障碍动作——详细计划（2026-11-09），完成（2026-11-09）
  - **HU 决定（2026-11-09）**：① 无宿主组件（Android DateTimePicker 渲染 null）：仅 setValue / accessibilityAction 在无宿主匹配时按 testID / 组件名回退到复合组件（不参与可见性判定，报错注明）；② accessibilityAction 的 native 档位走真实无障碍路径（iOS accessibilityActivate / Increment / Decrement / 自定义动作；Android performAccessibilityAction），Web 走 JS；③ iOS Picker / DatePicker 滚轮做**真实滚动**（native 档位，真实拖动 + 读回选中行校正；spike 先行）
  - 计划要点：protocol 加 setValue / adjustSlider / accessibilityAction，HostInput 加 select / fill；agent `actions/value.ts` 适配器表（Slider / Switch / Picker / SegmentedControl / DateTimePicker / DOM select·input date·range / 兜底报错列出回调）；native：Switch 状态不同时真实点击、adjustSlider 真实拖动并读回校验、Segmented 真实点分段、iOS 滚轮真实滚动；host：select→selectOption、date→fill、Switch→click、adjustSlider→drag；Driver setValue / adjustSlider / accessibilityAction；示例 App 装 4 包 + playground 控件 + features/values.feature；三端实跑 + pnpm run check + api.md / platforms.md
  - spike：① Android 从 JS 调 onChange 后卸载组件，原生日期对话框是否关闭；② 三端 slider 拇指位置换算；③ slider Web DOM；④ iOS UIPickerView / UIDatePicker（wheels）真实拖动：行高、无惯性拖动、列与目标值对应（UIDatePicker 列顺序随 locale）
  - 已查：SDK 58 自带版本 slider 5.2.1 / picker 2.11.4 / datetimepicker 9.2.1 / segmented-control 2.5.7；datetimepicker 无 Web 实现（渲染 null + warn），Android 版渲染 null（命令式对话框，无宿主节点）；segmented-control 在 Android / Web 是纯 JS 实现，iOS 是原生 UISegmentedControl
  - `setValue(t, value)` 统一入口：Slider（onValueChange + onSlidingComplete）、Switch（onValueChange）、Picker（@react-native-picker/picker：onValueChange + selectedValue 校验）、DateTimePicker（@react-native-community/datetimepicker：onChange(event, date)，三端）、SegmentedControl；未知组件报 ACTION_NOT_SUPPORTED 并列出找到的回调
  - native 档位：Slider 用真实拖动到比例位置（`adjustSlider(t, ratio)`）；iOS 原生 Picker / DatePicker 列滚动作为可选（spike 决定）
  - `accessibilityAction(t, name)`（onAccessibilityAction，三端）
- [x] 6.4 多指手势（spike → 实现）——详细计划（2026-11-09），完成（2026-11-09）
  - **HU 决定（2026-11-09）**：① 示例 App 加 react-native-gesture-handler（GestureHandlerRootView，回调 runOnJS(true)，不加 reanimated）；② 不用地图做验证对象（Android 需 API key），RNGH + iOS ScrollView 原生缩放覆盖两类识别器；③ Web：触摸视口用 CDP Input.dispatchTouchEvent，桌面视口 pinch / rotate 报 ACTION_NOT_SUPPORTED；④ 加通用 `multiTouch(fingers)`
  - 计划要点：原生 `multiGesture(tag, fingers)`（单指 gesture 改为其特例）；Driver `pinch(t, scale, { speed, angle })`（大倍数自动分次）、`rotate(t, radians, { speed })`、`multiTouch(fingers)`；js 档位 ACTION_NOT_SUPPORTED；示例 playground 加 RNGH Pinch+Rotation 方块、iOS 可缩放 ScrollView、双指滑动目标，`features/gestures.feature`（@needs-touch）
  - 已查：SDK 58 自带 react-native-gesture-handler ~3.3.0、reanimated 4.7.1、react-native-maps 1.29.11；示例 App 未装 RNGH；QSTouchInjector 现为单个静态 UITouch + 一个 hand / 一个 finger HID 事件
  - spike：iOS QSTouchInjector 改多指（N 个 UITouch + 一个 hand event 多个 finger child）、Android MotionEvent 多 pointer、Web CDP `Input.dispatchTouchEvent` 两点；验证 RNGH Pinch / Rotation、react-native-maps / 图片查看器
  - `pinch(t, scale, { speed, angle })`、`rotate(t, radians)`，三端（Detox pinch 仅 iOS）
- [x] 6.5 应用生命周期——详细计划（2026-11-09，HU 已确认），完成（2026-11-09）
  - **HU 决定（2026-11-09）**：① 启动参数用 JSON 单参数 `quiescoArgs`（base64），保留类型；② `app.sync.*` 运行时覆盖每个场景开始时恢复为 config 值；③ 某平台无法真正以深链接冷启动时，`relaunch({ url })` 降级为启动后再 openUrl，并在 platforms.md 写明差异（getInitialURL 拿不到）
  - **现状**：`DeviceProvider` 只有 boot / install / launch / terminate / grantPermissions / screenshot / injectInput；`LaunchParams` 只有 port + sessionId；`Session.launch()` 私有；Driver 已能在断线后透明等重连；agent 的 AgentConfig 只在 hello 时下发一次（`runtime.configure`）
  - **API 形态**：`app.device.*`（新类 `DeviceApi`，由 Session 构造并挂到 Driver 上；Driver 现有的 `pressBack` / `openUrl` 保留，`app.device` 上也有同名别名）；`app.sync.*`（新类 `SyncApi`）
  - **启动参数**：`relaunch({ args })` 的 args 是任意 JSON 对象，三端都只传一个参数 `quiescoArgs` = base64(JSON)（iOS `-quiescoArgs <b64>`、Android `--es quiescoArgs <b64>`、Web 写进 `window.__QUIESCO__.args`）：类型不丢（Detox 一律转字符串），也不会碰到 Android shell 引号问题。原生模块 `getLaunchParams` 多返回 `args`（Android 的 LaunchParamsStore 一起记住）；App 内 `quiesco.launchArgs()` 同步返回（生产 stub 返回 `{}`）；JS-only 构建在 iOS / Android 读不到 → 返回 `{}` 并打一次警告。config 增加 `launchArgs` 作为每次启动的默认值，relaunch 的 args 与之浅合并
  - **DeviceProvider 扩展**（可选方法，未实现的报 ACTION_NOT_SUPPORTED + 原因）：`LaunchParams` 加 `args?` / `url?`；新增 `clearData()`、`uninstall()`、`sendToBackground()`、`bringToForeground()`、`reversePort(port)` / `unreversePort(port)`、`screenshot({ clip? })`
  - **`app.device.relaunch({ args, url, clearData, reinstall, permissions })`**：始终是新进程（等同 Detox `newInstance: true`；回到前台用 `bringToForeground()`）。顺序：terminate →（reinstall：uninstall + install）→（clearData）→ grantPermissions（config 的 + 本次的）→ launch → 等连接。**默认保留数据**；`@hard-reset` 现有行为不变
    - iOS：clearData = 终止后清空 `simctl get_app_container <bundle> data` 下的内容（Documents / Library / tmp），Keychain 不动（6.6 再议）
    - Android：clearData = `pm clear`（会撤销权限 → 之后重授 config 中的权限）
    - Web：terminate 改为只关 page、保留 context（数据保留）；clearData = 新 context；reinstall / uninstall 在 Web 上等于 clearData（无安装概念，写进 platforms.md）
    - url（以深链接启动）：Android 非 dev client `am start -a VIEW -d <url>` 并带 extras；Web = 打开该路径；iOS 与 Android dev client 先 spike（见下）
  - **`terminate()`**：之后的元素调用不再空等重连超时，而是立即报 `APP_NOT_RUNNING`（新错误码）并提示 `relaunch()`
  - **`sendToBackground()` / `bringToForeground()`**（Detox 只有 sendToHome，且 iOS 依赖 XCUITest）：
    - Android：`input keyevent KEYCODE_HOME` / `am start` 启动器 intent（不带 CLEAR_TASK，进程不变）
    - iOS：spike —— 原生模块调用 `UIApplication suspend`（私有，Simulator 足够）退到后台，`simctl launch`（不带 `--terminate-running-process`）回前台；验证 AppState 'background' / 'active' 事件与连接是否保持
    - Web：spike —— CDP `Page.setWebLifecycleState` 或同 context 新开 page + bringToFront，看 `document.visibilityState` / `visibilitychange` 是否真实变化；都不行则报 ACTION_NOT_SUPPORTED（不做伪造事件）
    - 后台期间：agent 的 waitForIdle 在 AppState≠active 时把 frame-stable / timer / native 视为空闲（spike：Android 后台 RN 定时器暂停、不出帧）；Driver 记录后台状态，元素动作直接报 `APP_IN_BACKGROUND`（iOS 约 20 s 后挂起 JS，请求会无响应）
    - spike 结论：iOS 用原生 suspend（主屏幕），JS-only 构建退回打开设置 App；Android HOME / 启动器 intent；Web 报 ACTION_NOT_SUPPORTED；以 url 启动：Android dev client 用 `__expo_url` 格式、iOS 用 `-quiescoUrl` + 原生模块交给 expo-linking（均为真实冷启动，无需降级）
  - **`install()` / `uninstall()`**：iOS `simctl install / uninstall`、Android `adb install -r -g / uninstall`；需要 `binaryPath`，没有时报 CONFIG_ERROR
  - **`screenshot()` / `screenshot(target)`**：返回 PNG Buffer（保存到文件与命名属于 6.9）。元素截图 = 整屏截图后按元素 rect 裁剪：Web 用 `page.screenshot({ clip })`；iOS / Android 在 core 内用 node:zlib 自写最小 PNG 解码 / 编码（8 位 RGB / RGBA、非隔行，其它格式明确报错），缩放比 = 图片宽 / 窗口逻辑宽（agent 新增 `deviceInfo` 方法返回窗口尺寸与 pixelRatio）。元素被裁剪 / 部分出屏时只截可见部分
  - **`reversePort(port)` / `unreversePort(port)`**：Android `adb reverse`；iOS Simulator / Web 共享主机网络 → 直接成功（不报错，文档说明）
  - **运行时同步开关**（Detox 只能全局开关，#1513）：protocol 新增 agent 方法 `configure { sync: Partial }`；`app.sync.disable()` / `enable()`、`disableTracker(name)` / `enableTracker(name)`、`ignoreUrls.add(p)` / `remove(p)`、`ignoreElements.add(m)` / `remove(m)`；host 记住当前覆盖值，重连 / relaunch 后通过 hello 结果重新下发；**每个场景开始时恢复为 config 值**（beforeScenario）
  - **spike（实现前）**：① iOS 后台 / 前台（suspend + simctl launch，AppState 与 WebSocket 是否存活）；② 以 url 启动：iOS（`simctl launch` 无法传 URL；比较 `simctl openurl` 冷启动是否也弹确认框、由原生模块在启动时把 `-quiescoUrl` 交给 RCTLinkingManager / expo-linking 作为初始 URL 两种方式）与 Android dev client（dev client 自身占用了 VIEW intent），确认 expo-router 首屏是否进到该路由；③ Web 后台方式；④ Android `pm clear` 后 dev client 是否回到启动器页面（需要重新带 dev client URL 启动）
  - **原生（需重建两端 dev client）**：`getLaunchParams` 加 args / url；iOS `suspend`；iOS 初始 URL（视 spike 结果）
  - **示例 App**：playground 加「生命周期」区块：显示 `launchArgs()`、AppState 变化次数、一个持久化计数器（AsyncStorage / localStorage）；`features/lifecycle.feature`：带参数重启、保留 / 清除数据、以深链接启动、后台→前台、terminate 后报错、运行时关闭 timer tracker 后可操作一个无限轮询页、元素截图尺寸
  - **测试**：core 单测（各 provider 命令序列用假 exec 校验、relaunch 步骤顺序、PNG 解码 / 裁剪 / 编码往返、SyncApi 覆盖值与重下发）；agent 单测（launchArgs 解析、configure 合并、后台时 tracker 视为空闲）；三端实跑（iOS / Android native + js 档位、Web 三视口）；`pnpm run check`
  - **文档**：api.md（app.device / app.sync / launchArgs）、platforms.md（各端实现与差异）
- [x] 6.6 设备状态——详细计划（2026-11-09，HU 已确认）
  - **HU 决定（2026-11-09）**：① iOS / Android 撤销权限后系统杀进程 → Quiesco 自动保留数据重启并等连接后返回（页面回到初始路由，文档写明）；② 离线用混合方案：三端 agent 拦截 fetch / XHR / WebSocket（不含 Quiesco 自身连接），Android 另用 `svc wifi/data disable` 真断网（NetInfo 可感知）、Web 另用 `context.setOffline`，iOS 的 NetInfo 感知不到（文档写明）；③ 设备状态改动在每个场景开始时恢复，只恢复本会话改过的项
  - **API**：全部挂在 `app.device.*`，每项三端；做不到的报 ACTION_NOT_SUPPORTED + 原因并写进 platforms.md。设备状态在会话结束 / 场景开始时恢复默认（见决策点）
  - **已有，不再重复**：Detox `setURLBlacklist` = 6.5 的 `app.sync.ignoreUrls.add()`（文档补一行对照）
  - **工具实测（2026-11-09）**：simctl 有 `location`、`privacy grant/revoke/reset`、`ui appearance`、`ui content_size`、`status_bar`、`pbcopy/pbpaste`；Android API 37 有 `cmd locale set-app-locales`、`cmd uimode night`，**没有** `cmd clipboard`；示例 App 锁竖屏（app.json `orientation: portrait`，Android `screenOrientation="portrait"`），Android `configChanges` 含 orientation / uiMode，不含 locale / fontScale
  - **spike 结论（2026-11-09）**：旋转三端可行（iOS 原生 geometry 请求）；外观 / 语言要求 App 不锁定（userInterfaceStyle automatic、iOS 声明 CFBundleLocalizations）——设置后读回校验，不一致就报错说明；Android 改字号 / 语言会重建 Activity（同进程同 JS，根组件重挂载），设置后等空闲即可；iOS 语言靠带参重启；撤销权限只有 Android 杀进程 → provider 声明 `revokeRestartsApp`，仅此时自动重启；剪贴板两端都走原生模块（iOS 外部写入会弹「允许粘贴」）；Android 离线真断网不影响 adb reverse
  - **批次 A（本子阶段先做）**
    - `setOrientation('portrait' | 'landscape')`：iOS 原生模块 `UIWindowScene.requestGeometryUpdate`（simctl 无旋转命令）；Android `settings put system accelerometer_rotation 0` + `user_rotation 0/1`；Web 视口宽高互换（`page.setViewportSize`）。之后等 `Dimensions` 变化再等空闲。App 锁方向时报错说明（示例 App 改为 `orientation: default`）
    - `setLocation({ lat, lon })`：simctl `location set`；Android `adb emu geo fix`（仅模拟器，真机 6.13 再议）；Web `context.setGeolocation`
    - `setPermission(name, 'grant' | 'revoke')`：iOS `simctl privacy`；Android `pm grant / revoke`；Web `grantPermissions` / `clearPermissions` 后重授其余。**iOS / Android 撤销权限时系统会杀掉 App**（见决策点）
    - `setAppearance('light' | 'dark')`：simctl `ui appearance`；`cmd uimode night yes/no`；Web `page.emulateMedia({ colorScheme })`
    - `setFontScale(n)`：iOS `ui content_size`（取最接近的 Dynamic Type 档位，文档列映射）；Android `settings put system font_scale`；Web 无系统字号 → ACTION_NOT_SUPPORTED
    - `setLocale('ja-JP')`：iOS 带 `-AppleLanguages (ja) -AppleLocale ja_JP` 重启；Android `cmd locale set-app-locales`（spike：是否重建 Activity / 重载 JS）；Web context `locale` 只能新建 context → 重启（保留数据）
  - **批次 B（同一子阶段，A 实跑通过后再做）**
    - `setStatusBar({ time, battery, wifi, ... })` / `resetStatusBar()`：simctl `status_bar override`；Android SystemUI demo mode（`sysui_demo_allowed` + broadcast）；Web 无状态栏 → 直接成功
    - `setNetwork('offline' | 'online')`：见决策点
      - 实现变更（2026-11-09）：Web 不用 `context.setOffline`（会掐断 Quiesco 自身 WebSocket），改为 route 中止 + CDP `Network.overrideNetworkState`（findings「6.6 批次 B 发现」）
    - `clipboard.set(text)` / `clipboard.get()`：Android 无 shell 命令 → 原生模块在 App 进程内读写 ClipboardManager；iOS simctl `pbcopy / pbpaste`（spike：App 读取时 iOS 16+ 是否弹「允许粘贴」，弹则改为原生模块进程内写）；Web `grantPermissions(['clipboard-read','clipboard-write'])` + `navigator.clipboard`
  - **spike（实现前）**：① iOS `requestGeometryUpdate` 从原生模块调用是否生效、RN `Dimensions` / `useWindowDimensions` 是否更新；Android user_rotation 对 dev client 的 Activity 是否生效；② Android `set-app-locales` / `font_scale` 后 RN 是重建 Activity 还是整个 JS 重载（连接是否断开、AppState）；③ `simctl privacy revoke` / `pm revoke` 杀进程的确认；④ iOS `pbcopy` 后 App 读剪贴板是否弹框；⑤ 离线方案（见决策点）在 RN `fetch` 与 `@react-native-community/netinfo` 上的表现
  - **原生（需重建两端 dev client）**：iOS `setOrientation`；两端剪贴板读写（视 spike）
  - **示例 App**：新的隐藏页 `device`（backdoor openDevice）：显示窗口宽高与方向、当前位置（expo-location，已有 location 权限）、外观（`useColorScheme`）、`PixelRatio.getFontScale()`、`Intl` / expo-localization 的语言、剪贴板读取按钮、一个 fetch 请求结果；`features/device.feature`；app.json `orientation: default`（现有场景全量回归，确认不受影响）
  - **测试**：core 单测（各 provider 命令序列、Dynamic Type 档位映射、权限撤销后的重启流程、状态恢复）；agent 单测（离线拦截如采用）；三端实跑（iOS / Android native + js 档位、Web 三视口）；`pnpm run check`
  - **文档**：api.md（app.device 新方法）、platforms.md（各端实现与限制）
- [ ] 6.7 系统集成（spike → 实现，逐项可降级）
  - **HU 决定（2026-11-09）**：① 示例 App 加 expo-notifications 与 expo-local-authentication（重建两端 dev client）；② Android 推送 = @quiesco/native 以 App 身份发真实本地通知（点击打开 App；不经 FCM，expo-notifications 的远程推送回调不触发，文档说明）；③ iOS 系统弹窗先 spike XCUITest 辅助进程，spike 后再定是否实现；④ Android `clearKeychain()` 报 ACTION_NOT_SUPPORTED（提示 relaunch({ clearData: true })）
  - **HU 决定（2026-11-09，spike 后）**：⑤ `biometrics.fail()` 只模拟不匹配（系统重试弹窗保留，与真机 / Detox unmatchFace 一致；让 App 收到失败要配合系统弹窗操作，批次 C）；⑥ 示例加 react-native-shake（演示 shake）
  - **HU 决定（2026-11-10，批次 C）**：API `app.device.system.tap({ text } | { id })` / `expectVisible` / `expectNotVisible` / `allowPermission()` / `denyPermission()`；先 Android（uiautomator，只查 App 以外的包）；示例加「请求通知权限」+ 生物识别 fail 后点取消；Web 的 alert / confirm 起初定为本批次一起做，**改为延后（HU 2026-11-10）**：dialog 打开时页面冻结、点击与 RPC 都不返回，需改 core 动作同步，作为以后的单独小批次；本批次 Web 的 system.* 报 ACTION_NOT_SUPPORTED、未处理 dialog 仍自动关闭；iOS XCUITest spike 放在 Android 之后
  - **分批**：A 生物识别 / shake / clearKeychain → B 推送 → C 系统弹窗（Android uiautomator；iOS 视 spike）。每批 spike → 实现 → 三端实跑。Web 均为 ACTION_NOT_SUPPORTED（写进 platforms.md）
  - 推送：`sendNotification(payload)`（iOS simctl push 到前台 / 后台、点击通知进入；Android `cmd notification post` 或经 agent 调 expo-notifications 的接收路径——spike 决定）
  - 生物识别：`biometrics.enroll(bool)` / `match()` / `fail()`（iOS notifyutil `com.apple.BiometricKit_Sim.*`；Android `adb emu finger touch`）——Detox 仅 iOS
  - `shake()`（iOS 原生模块发 motionEnded；Android `adb emu sensor set acceleration`）、`clearKeychain()`（iOS simctl keychain reset；Android 等价为清除 App 数据）
  - 系统弹窗：`system.tap({ text })` / `system.expectVisible`（Android uiautomator dump + input tap；iOS 进程外弹窗无法用进程内注入，spike 评估 XCUITest 辅助进程，否则以「预授权 + 运行时授权」规避并在文档说明）
- [ ] 6.8 WebView（spike → 实现）
  - `app.webview(t?).element({ css | xpath | id | text })`：agent 找到 react-native-webview 实例，经 injectJavaScript + 消息通道执行脚本 / 查询 DOM；动作（tap / type / replaceText / scrollIntoView）、断言（text / exists / visible）、`runScript`、`url()` / `title()`；WebView 内网络与页面加载纳入同步；Web 平台上 iframe 同 API
- [ ] 6.9 证据与诊断（artifacts）
  - 录像：iOS `simctl io recordVideo`、Android `screenrecord`（3 分钟分段）、Playwright recordVideo；策略 none / failing / all
  - 设备日志：iOS `log stream --predicate` 按 App 过滤、Android `logcat --pid`、Web console；失败时附加
  - 时间线：每步动作耗时、同步等待耗时与当时忙的 tracker，输出 Chrome trace JSON + 失败场景附 HTML 摘要（Detox 的 artifact 文档仍是 To be done）
  - 失败元素树加高亮截图（目标 rect 叠框）
- [ ] 6.10 运行器适配器与网络同步加固
  - 官方 `@quiesco/jest`、`@quiesco/vitest`（session 生命周期、失败证据附件、tag → describe 过滤、串行校验）；README / docs 的手写示例改用适配器（Detox 只有 Jest）
  - 验证并加固 network tracker：`expo/fetch`（SDK 56+ 全局 fetch 与直接 import 两种）、WebSocket 握手、EventSource——对应 Detox #4973（Android 网络同步失明）
  - `@quiesco/steps` 增加新动作的中 / 日 / 英步骤
- [ ] 6.11 验收与对比文档
  - 示例 App 增加「能力演示」页面（列表拖拽排序、滑块、开关、选择器、日期、地图或可缩放图片、WebView、深链接、定位、通知、生物识别、横屏布局）及对应 features，三端实跑（单平台不支持的项用平台 tag）
  - `docs/detox-comparison.md`：逐项对照表（Detox 20.51.4 vs Quiesco，三端支持情况、实测结果）+ 痛点对应改进的验证结果
  - `pnpm run check` 全绿；三端回归 benchmarks 不退化
- [ ] 6.12 并行执行（重做）：每个 worker 一台设备 / 一个浏览器 context；保留 Phase 4 的修复（Android 全部 read-only + 冷启动 -no-snapshot-load、install 前 force-stop、LaunchParamsStore）；解决「先串行（可写启动）后并行」被拒的问题（Phase 4 遗留，4.8 记录）；cucumber `--parallel`、Jest workers、Vitest 多文件三种运行器；iOS 20 次 / Android 5 次 / Web 5 次并行稳定性基准
- [ ] 6.13 真机：Android 真机（adb，无 emulator 专属命令时逐项降级并报 ACTION_NOT_SUPPORTED + 原因）；iOS 真机（devicectl 安装 / 启动 / 传参、签名配置、网络连接改为局域网或 USB 转发，spike 先行）；**需要 HU 提供并连接真机**，验收前暂停确认
- [ ] 6.14 LLM 驱动（对标 Detox Pilot）：`app.ai.perform('…')` / `app.ai.expect('…')`，以元素树 + 截图为上下文、Driver API 为工具；实现前先读 claude-api 技能确认当前模型与 SDK 用法；结果可「固化」为普通 step 代码（Detox 没有）；默认关闭，需配置 API key
- **验收**：对照表中 Detox 的每一项都有对应能力（或写明替代方案）；示例 App 新 features 在 iOS / Android / Chromium 通过；Detox 单平台独占项在 Quiesco 中至少两端可用
- **Status:** in_progress（6.0–6.5 完成，下一步 6.6）

## 待 HU 决定（requirements.md §11，遇到时暂停询问）
| # | 事项 | 何时需要 | 状态 |
|---|------|---------|------|
| 1 | 开源许可证 | 发布前（Phase 5 前即可） | ✅ MIT（HU 2026-11-08） |
| 2 | 最低支持 Expo SDK | Phase 0 结束时给建议 | ✅ SDK 58（HU 2026-11-07）；Phase 4 CI 冒烟 55–57 后可再下调 |
| 3 | iOS 注入替代方案（若 S4 失败） | S4 结论后 | 不需要（S4 成功） |
| 4 | CI：GitHub Actions / EAS Workflows | Phase 1 搭骨架时（依赖检查要进 CI） | ✅ GitHub Actions（HU 2026-11-07） |
| 5 | npm `@quiesco` 组织与发布流程 | 发布前 | 未决 |
| 6 | Web 是否首版验收 Firefox/WebKit | Phase 3 前 | ✅ 只验收 Chromium（HU 2026-11-08）；provider 可配置 firefox / webkit 但不作为验收对象 |
| 7 | Web 视口默认值（手机/桌面/两者） | Phase 3 前 | ✅ 手机 / 平板 / 桌面三个视口都作为验收对象（HU 2026-11-08）；默认手机 |

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 规划文件放在 `.planning/2026-11-07-quiesco/`，不放项目根目录 | HU 要求 plan 文件不放根目录 |
| spike 代码放 `spikes/`，与正式 `packages/` 隔离 | spike 是一次性验证，避免污染正式包结构 |
| spike 目标 Expo SDK 58（RN 0.88.1 / React 19.3.0） | 当前 latest；SDK ≥55 强制 New Architecture，与需求一致 |
| `.planning/` 纳入 git | HU 已提交（aafb589） |
| 原生取坐标统一用 `getPublicInstanceFromInternalInstanceHandle(fiber).getBoundingClientRect()`（同步）；debug 包装已有 hook，release/Web 自装 hook | S1 实测，三端接口形态一致 |
| React 空闲 = root 字段（A）&& scheduler 挂起任务（B，替换 scheduler 导出函数）；所有 tracker 统一「跨宏任务两次确认」 | S2 实测：A、B 互补；单次检查在定时器批量执行时会误判 |
| Android 触摸注入：MotionEvent → Activity.dispatchTouchEvent（公开 API），坐标 dp×density | S3 实测 Pressable / RNGH 均正常 |
| iOS 触摸注入：合成 UITouch + UIEvent + IOHIDEvent（私有 API，仅 e2e 构建），`UIApplication.sendEvent:`，坐标 pt 直接使用 | S4 实测 Pressable / RNGH 均正常，§11-3 替代方案不需要 |
| 连接参数：iOS 进程参数（UserDefaults）/ Android Intent extras / Web addInitScript；构建期 env 只作兜底；不用深链接 | S5 三端实测握手成功；深链接在 iOS 上有系统确认框 |
| 生产剔除：JS 用 Metro resolver 替换为桩（`withQuiesco`）；原生用 config plugin 在非 e2e prebuild 时注入 autolinking exclude；e2e 判定统一用 `EXPO_PUBLIC_QUIESCO=1` | S6 实测三端；node_modules 内的环境变量守卫无效 |
| fiber-adapter 的平台差异只有 3 点：宿主 testID prop 名（testID / data-testid）、文本位置（HostText / props.children）、取坐标对象（public instance / DOM 元素） | S7 实测；查询规则统一为宿主 props 匹配 |
| TS 使用 6.0.3（不用 7.x） | typescript-eslint peer `<6.1.0`，Expo SDK 58 捆绑 ~6.0.3 |
| Node 侧包用 `tsc -b` 编译 ESM；agent 通过 `react-native` 字段让 Metro 直接读 TS 源码；`.npmrc` 用 `node-linker=hoisted` | 开发时 App 端不需要构建步骤，Metro / autolinking 兼容 |
| protocol 只放类型和常量；正则在协议上表示为 `{ regex: { source, flags } }`，转换由两端各自完成；Quiesco 错误码从 1001 起，`error.data` 按错误名定型 | 需求 §5「只包含类型和常量」；避开 JSON-RPC 保留区间 |
| 后门 / onReset / 软重置的最小实现提前到 Phase 1，完善留在 Phase 2 | 第 9 节验收用例需要；HU 2026-11-07 确认 |
| 最低支持 Expo SDK 58 | HU 决定（§11-2）；55–57 静态检查通过，Phase 4 冒烟后再考虑下调 |
| CI 使用 GitHub Actions | HU 决定（§11-4） |
| §6.2-4 改为 `idle-callback` tracker：跟踪挂起的 requestIdleCallback，旧版本兼容 InteractionManager；requirements.md 已同步 | RN 0.88 移除 InteractionManager；HU 2026-11-07 确认 |
| `text` 匹配只返回「最深」的匹配节点（若某后代也满足整个 Matcher，则丢弃祖先） | 容器的文本包含子节点文本，否则 `{ text: 'Login' }` 会同时命中按钮 View 和 RCTText，动作必然报多个匹配 |
| agent 源码内相对 import 不带扩展名；平台差异用 `default-deps.native.ts` / `default-deps.ts`（Metro 平台扩展名解析） | Metro 直接读 TS 源码；Web bundle 中不能出现 `react-native/Libraries/Renderer` 的 require（否则会把 Fabric 渲染器打进 Web 包） |
| frame-stable 只在 waitForIdle 期间采样（tracker 接口增加可选 `beginWait` / `endWait`） | 空闲时不每帧计算整棵树的哈希 |
| network tracker：在被跟踪的 `fetch()` 同步执行期间发出的 XHR 不重复计数 | RN 的 fetch 基于 XHR（whatwg-fetch），否则同一请求显示两次 |
| 新增依赖规则 `fiber-adapter-public-api-only`：fiber-adapter 外只能 import 其 `index.ts` | 让「Fiber 结构不出 fiber-adapter」由 CI 保证，反向测试已拦住 |
| hello 的返回值增加 `config: AgentConfig`（sync 各项、ignoreUrls、tracker 开关、logLevel）；协议版本仍为 1（未发布） | tracker 必须在 import 时安装，配置在 quiesco.config.ts（Host 侧），只能连上后再下发；tracker 改为可在安装后重新配置 |
| tracker、DevTools hook、console/错误转发在 agent import 时安装；QuiescoRoot 挂载时只做 setScope、报告安装问题、建立连接 | 子组件的 effect 先于 QuiescoRoot 的 effect 执行，挂载时才安装会漏掉 App 挂载时发出的请求（与 §6.7「QuiescoRoot 安装 trackers」的字面不同，效果更稳） |
| `pressBack` / `openUrl` 由 agent 返回 `hostInput`，交给 Host 的 DeviceProvider 执行（adb keyevent / am start、Playwright） | agent 不需要按平台分支；Android 用 adb 最可靠 |
| Phase 1 的 `native` 档位直接报 ACTION_NOT_SUPPORTED（提示改 `actions.mode: 'js'`） | 原生注入是 Phase 2 的范围 |
| JS 档位：tap 向上找最近的 `onPress`（连同同一组件的 onPressIn/Out，`disabled` 时不触发）；type 一次性调用 `onChangeText(当前 value + 文本)`；scroll 调最近 ScrollView 实例的 `scrollTo`，偏移量由内容容器与滚动视图的坐标差算出 | 与 Pressability 行为一致；限制写在 `actions/js.ts` 注释里 |
| 动作目标：等待到「唯一且可见」或超时（ELEMENT_NOT_FOUND 区分不存在 / 不可见），多个匹配立即报 MULTIPLE_MATCHES | 加载中的元素不需要测试侧重试 |
| 断言多匹配语义：visible = 任一可见；notVisible = 无一可见；text / prop 要求恰好 1 个；prop 先读宿主 props，再读拥有它的复合组件 props（如 Pressable 的 `disabled`、TextInput 的 `value`） | §6.4「断言类操作按断言语义处理」 |
| `withQuiesco` 用纯 CJS 的 `metro.cjs`；构建期兜底参数生成到 `<project>/.expo/quiesco/build-config.js`，只替换 agent `src/` 内的 `./build-config` | Node 不能在 node_modules 中执行 TS；`.expo` 不在 Expo 默认 blockList 内且默认被 gitignore |
| `autoInstallPeers: false`（pnpm-workspace.yaml） | pnpm 自动把 react 19.3.1 / react-native 嵌套装进 agent，会造成两份 React（hooks 失效） |
| 新增 `quiesco.registerStorage(adapter)`；内置存储适配器按平台分文件：native 清 AsyncStorage 默认存储（`try` 块内 `require`，Metro 视为可选依赖，未安装时也能打包），web 清 localStorage / sessionStorage / 所有 IndexedDB | §6.5「存储适配器可由用户注册」「按平台选择实现」；AsyncStorage v3 的 `createAsyncStorage(name)` 命名存储需用户自行注册 |
| 后门：参数和返回值都做严格 JSON 检查（Date / Map / undefined / NaN / 循环引用都报 NOT_SERIALIZABLE 并给出路径）；返回 undefined 视为 null | §6.6「报清晰的错误」 |
| 软重置失败时报 RESET_FAILED，`step` 为 `storage:<名称>` / `onReset#<序号>` / `remount`；QuiescoRoot 未挂载时在 remount 步骤失败 | §6.5 的 4 个步骤可逐一定位 |
| 类型测试使用各包的 `tsconfig.test.json`（include src + test）；agent 用类型测试保证 stub 与正式入口的导出完全一致 | 原先 vitest typecheck 用的 tsconfig 只包含 src，类型测试从未真正执行（反向测试确认） |
| Host 接受 `sessionId: null` 的 agent，映射到唯一允许匿名的 session（每个 worker 一个 server） | Phase 1 是 JS-only 档位，agent 读不到 Intent extras；extras 照传，为 Phase 2 准备 |
| WS Server 默认监听所有网卡（`server.host` 可配置） | 与 spike S5 验证过的行为一致；adb reverse 走 127.0.0.1，浏览器可能先解析 ::1 |
| 动作档位默认「自动」：未配置 `actions.mode` 时，hello 中 `nativeModule: true` 用 native，否则用 js（并提示一次） | 规格默认 native，但 Phase 1 没有原生模块，开箱即可运行 |
| Driver 的 matcher：裸字符串 = testID，`text` / `label` 可用 RegExp | step 中写起来简洁；转换为协议的 RegexPattern |
| Host 侧请求超时 = agent 超时 + 5 秒（墙上时间），超时报 AGENT_TIMEOUT 并提示「JS 线程可能被长任务阻塞」 | docs/spikes/02 §6 |
| App 的 `error` 事件让正在执行的调用立即失败（APP_ERROR）；两次调用之间发生的错误在下一次调用时抛出 | §7「当前步骤立即失败」 |
| 配置文件直接用 `import()` 加载，`.ts` 依赖 Node 原生类型擦除（只允许可擦除语法），不引入 jiti 等 | Node 24；dist 实测加载 `.ts` 配置成功 |
| Android 判定 AVD 名称优先用 `getprop ro.boot.qemu.avd_name`，再退回 `adb emu avd name` | 实测 API 37 上 `emu avd name` 因 console 认证返回空，导致误判为未启动而重复启动 emulator |
| `@quiesco/cucumber` 把 `@cucumber/cucumber` 设为 peer 依赖（>=12） | 包内自带一份 cucumber 时，hooks 会注册到另一个实例上，用户的运行器看不到 |
| 平台 tag 判定（`runsOnPlatform`）与可配置 tag 名（`config.tags`）放在 core | 与运行器无关，将来的 Jest / Vitest 适配器复用 |
| cucumber 适配：lifecycle 与 cucumber 解耦（可单测）；默认步骤超时 60s、BeforeAll 10 分钟；通过的场景若之后收到 App 错误也判失败；失败时附加截图 / 元素树 JSON / tracker 状态 | §6.10 |
| pnpm 设置统一写在 `pnpm-workspace.yaml`（`nodeLinker: hoisted`、`autoInstallPeers: false`），删除 `.npmrc` | pnpm 12 忽略 `.npmrc` 中的 pnpm 专用设置；1.1 的 hoisted 实际从未生效（一直是 isolated） |
| 示例 App 的页面切换动画用 JS `Animated`（动画 `left`，非 native driver），时长 `EXPO_PUBLIC_TRANSITION_MS` | native-stack 在 Android 上不能可靠调时长；动画布局属性才会让坐标变化，可检验 frame-stable。UI 线程 / transform 动画是否被 frame-stable 捕获，留到 Phase 2（native 档位需要变换后的坐标） |
| core 新增 `apps.android.reversePorts`（App 访问的本机端口，用 adb reverse 转发） | 示例 App 的 mock 后端 3001 |
| 示例 App：Metro 用 8082 端口（`devClient.metroUrl`）；配置文件用 `quiesco.config.mts`；`features/package.json` 设 `"type": "module"` | 8081 被 Phase 0 的 spike Metro 占用（未关闭它）；避免 Node 的 MODULE_TYPELESS 警告，又不影响 CJS 的 metro.config.js |
| 删除 create-expo-app 模板自带的 `LICENSE`（Expo MIT）与 `.claude/settings.json`（自动启用插件） | 项目许可证待 HU 决定（§11-1），模板许可证容易被误认为项目许可证；插件设置会影响打开目录的人 |
| `pnpm run check` 与 CI 增加示例 App 类型检查（`typecheck:examples`） | 包 API 变化时示例 App 及 step 定义能被及时发现 |
| mock server 增加 `MOCK_STALL="<METHOD> <path>"`（该接口永不返回） | 验收「同步超时能指出请求」：全局延迟会先卡住 onReset / backdoor，只能得到 AGENT_TIMEOUT |
| native 档位按原生 view tag 定位：JS 传 `__nativeTag`，原生取 View 的实际窗口坐标，并在目标 View 所在窗口注入 | HU 2026-11-07（Phase 2 决定 1）：能正确点击 native driver 动画中的元素与 Modal 内元素 |
| native 档位文本输入走 `InputConnection.commitText`（先点击聚焦） | HU 2026-11-07（决定 2）：支持中文；限制是整段写入而非逐键 |
| Phase 2 在 `@quiesco/native` 内置只管 Android 的 config plugin（非 e2e 排除 autolinking + e2e 放行 localhost 明文）；完整 expo-plugin 仍在 Phase 4 | HU 2026-11-07（决定 3）：从一开始保证生产包不含注入模块 |
| 动作执行抽象为 `ActionPerformer`（js / native 两个实现），runtime 的目标解析、同步、scrollTo 循环共用 | 两种档位行为一致，只在「怎么执行」上不同 |
| native 档位注入前检查：原生 View 位置连续两次不变、所在窗口有输入焦点、该点最上层元素是目标或其后代（pointerEvents none / box-none 视为透明）；否则报新增的 `ELEMENT_OBSCURED`（1014） | 真实触摸到不了的元素要明确报错，而不是点到别处 |
| 同一元素的判断用原生 view tag（HostNode 每次遍历都会重建） | 单元测试发现按对象比较会误报「被自己遮挡」 |
| `@quiesco/native` 的 Android 包名 `dev.quiesco.nativemodule`；package.json 不设 `"type": "module"`（app.plugin.js 为 CJS） | `native` 是 Java 关键字；Expo 以 require 加载 config plugin |
| ESLint：`_` 开头的参数允许不使用 | 测试替身需要与真实签名一致 |
| `@quiesco/web`：每次 launch 新建 browser context；`addInitScript` 注入连接参数；触摸视口用 touchscreen.tap，其余用鼠标；滚动用 wheel（协议新增 HostInput `wheel`） | §6.9；RNW ScrollView 不响应鼠标拖动 |
| core 用变量包名动态 import `@quiesco/web`（depcruise / TS 均不视为静态依赖）；未安装时报出安装命令 | §5「web 通过插件机制在运行时按配置加载」；只测原生端不需要 Playwright |
| 没有 `@quiesco/native` 时 native 档位改为 Host 注入：agent 做稳定 / 命中检查后返回 HostInput，Driver 交给 provider 注入再等空闲；scrollTo 在这种模式下退回 JS 滚动 | agent 内不按平台分支；scrollTo 需要在 agent 内循环 |
| `HostNode.isSameElement()` 按底层宿主实例（Fabric 实例 / DOM 元素）比较，替代按 native tag 比较 | Web 没有 native tag，按对象比较会误报「被自己遮挡」 |
| 连接断开时 Driver 等待同一 session 的新连接；只读调用（query / assert / waitForIdle / getTree / getIdleState）断线后重试一次 | §6.2 整页刷新后透明重连；动作等非幂等调用不重试 |
| 新增 `appErrors.ignore` / `ignoreDefaults` 与 `DEFAULT_IGNORED_APP_ERRORS`（默认忽略 Expo Router 静态 Web 的 `Requiring unknown module`），被忽略的错误记为警告；docs/known-issues.md | 实测无 Quiesco 时真实用户同样触发（ErrorUtils 记录到 FATAL），App 自行恢复；不忽略会让第一个导航场景误报失败 |
| Android `boot()` 额外等待用户进入 RUNNING_UNLOCKED，超时提示 `adb reboot` | 实测用户卡在 BOOTING 时 `am start` 报「Activity class does not exist」 |
| 示例 App Web 用 `web.output: 'static'`；三视口尺寸写在 quiesco.config（`QUIESCO_VIEWPORT`）；`QUIESCO_WEB_URL` 切换开发服务器 | §11-7、§6.13 |
| Phase 6 对标 Detox 20.51.4，单平台独占能力尽量三端实现 | HU 2026-11-08：功能比 Detox 全、体验比 Detox 好 |
| 重新做并行（6.12）、做真机（6.13）与 LLM 驱动（6.14）；iOS 系统弹窗先 spike | HU 2026-11-08 |
| 可见判定加入祖先滚动容器裁剪，默认生效 | HU 2026-11-09（6.1）：滚出容器但仍在窗口内的元素不应算可见 |
| 新增链式断言 `app.expect(t)[.not].toBeXxx()`，与 `expectXxx` 共用实现 | HU 2026-11-09（6.1）：便于从 Detox 迁移 |
| 多宿主控件（如 RNW Switch = 外层 div + 内部 input）：父宿主渲染时直接创建、语义类型相同的子宿主是「部件」，不单独参与 `type` 匹配；控件的 checked / value / enabled / 焦点 / label 从部件读取 | 6.1 Web 实测：一个 Switch 被数成 2 个，状态与 aria-label 在内部 input 上；「直接创建」由 fiber-adapter 按 work tag 判定（不受压缩影响） |
| `notChecked` 严格：没有勾选状态的元素既不满足 checked 也不满足 notChecked | 未定义状态当作「未勾选」会让断言在错误的元素上误通过（6.1 Web 首轮即如此） |
| 动作目标解析到截止时间时，若同时目标不存在，报 ELEMENT_NOT_FOUND（附「App 也仍忙」的原因），而不是最后几毫秒的 SYNC_TIMEOUT | 6.1 Web 实测：真实原因（匹配不到）被误报为 frame-stable 超时 |
| 示例配置 `QUIESCO_METRO_URL` 可覆盖 Metro 地址（默认 8082） | 停止旧 Metro 被权限拒绝；另起干净 Metro（8083）验证，不影响现有进程 |
| 原生实跑用临时 Metro（空闲端口、--clear、QUIESCO_METRO_URL），跑完即停；不碰 8082 | HU 2026-11-09（6.2）：不留后台服务 |
| 示例 App 增加隐藏的 playground 页放测试控件 | HU 2026-11-09（6.2） |
| iOS 触摸可达性按 React tag 判断：原生返回命中视图链的 tag（`hitTags`），JS 取链上第一个 React 宿主，必须在目标的 React 子树内；点击指定点时用原生 `hitAt` 在该点判断 | 6.2 iOS 实测：Fabric 不把每个 React 子节点挂在其 React 父节点的原生视图里（不形成层叠上下文的视图，其子节点挂到更上层），原先「命中视图是原生后代」的判断会误报 ELEMENT_OBSCURED |
| scrollToEdge / scrollToIndex 每一步（及最终等待空闲）各有完整超时，步数上限 60；Host 等待相应放宽；原生档位 scrollToEdge 用快速甩动 | 6.2 实测：200 行列表用慢速拖动 / 共用一个 10s 期限必然超时 |
| scrollToIndex 先读已测量的最大行（RN `_listMetrics`、RNW `_highestMeasuredFrameIndex`），不安全时先滚到该行再重试；都读不到时按屏滚动重试 | 无 getItemLayout 时 RN 的 scrollToIndex 会抛 invariant；Quiesco 不要求 App 提供 getItemLayout（Detox 只支持 Android） |
| js 档位 tap 在开关 / 复选框上（无 onPress）调用 `onValueChange(!value)` | 6.2 js 档位实测：开关无 onPress；这是原生控件的点击语义 |
| 临时 Metro 不加 `CI=1` | CI=1 时 Expo 关闭文件监听，Metro 一直提供旧代码（6.2 实测踩坑） |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Android 截图全黑，App 不渲染 | 1 | 屏幕休眠 + ACCESS_LOCAL_NETWORK 授权弹窗挡住；唤醒 + `pm grant` 解决 |
| `adb shell am start -d` 的 URL 参数丢失 | 1 | `&` 被设备端 shell 解析；需要再加一层引号（待在 DeviceProvider 中处理） |
| `expo run:ios -d <udid>` 失败：`connect ENOENT /var/run/usbmuxd` | 1 | Expo CLI 解析设备时会枚举物理设备，本机没有 usbmuxd；改用 `xcodebuild -sdk iphonesimulator` + `simctl install`（也是 iOS DeviceProvider 的路线）。注意：后台命令用了 `| tail`，退出码被吞掉，以后加 `set -o pipefail` |
| S2 测量出「定时器延迟 500ms」 | 1 | 加 scheduler 运行日志定位：测试代码 `Slow` 组件未 memo 导致长渲染，非 RN 问题 |
| S6 用副本验证原生剔除：两种模式都没有模块 | 1 | 副本的 node_modules 是符号链接，autolinking resolve 过滤掉了本地模块 → 改在主项目上 prebuild --clean |
| S6 用 dexdump 按类名检查，对照组也是 0 | 1 | R8 混淆了包名 → 改为检查 Module 名称字符串 |
| `pnpm ci` 没有执行自定义脚本，而是做了干净安装 | 1 | pnpm 12 中 `ci` 是内置命令 → 脚本改名为 `check`（`pnpm run check`） |
| dependency-cruiser 把 core 的 vitest.config.ts 报为违规 | 1 | 规则的 from 限定为 `packages/*/src/`；同时把未安装的裸包名也纳入匹配，并用故意制造的违规确认 4 条规则都能拦住 |
| 轮询脚本超时卡住 | 2 | `uiautomator dump` 不返回、macOS 无 `timeout`；改为截图确认 |
| pnpm 自动安装 peer：react 19.3.1 + react-native 0.88.1 被嵌套装进 packages/agent | 1 | `.npmrc` 的 `auto-install-peers=false` 无效（pnpm 12）→ 改写在 pnpm-workspace.yaml 的 `autoInstallPeers: false`，从干净 lockfile 重装 |
| vitest 类型测试从 1.2 起没有生效（tsconfig 的 include 只有 src，test 文件不被 tsc 检查，却显示通过） | 1 | 增加 tsconfig.test.json 并在 vitest typecheck.tsconfig 中指定；protocol / agent 各做一次反向测试确认能报错；顺带修掉暴露出来的测试代码类型错误 |
| 真机冒烟：AndroidProvider 没认出正在运行的 AVD，又 spawn 了一个同名 emulator（boot 挂起） | 1 | `adb emu avd name` 返回空 → 改用 `getprop ro.boot.qemu.avd_name` 优先；确认多余的 emulator 已自行退出（只剩原进程） |
| `.npmrc` 的 `node-linker=hoisted` 从 1.1 起没有生效（`.modules.yaml` 显示 isolated） | 1 | 改写到 pnpm-workspace.yaml 的 `nodeLinker: hoisted` 并删除 .npmrc；重装后确认 hoisted，全部检查仍通过 |
| 6.1 Web 首轮：`{ type: 'switch' }` 数出 2 个 | 1 | RNW Switch 外层 div（displayName Switch）+ 内部 input role=switch 都判为 switch → 引入「部件」规则（renderedWithParent） |
| 6.1 Web 第二轮：tap `{ type:'switch', label }` 报 SYNC_TIMEOUT | 1 | 实为匹配不到（aria-label 在部件上）；label 回退到部件 + 解析截止时报 ELEMENT_NOT_FOUND；反向测试确认 |
| 6.1 原生：Metro 8082 打包失败「Unable to resolve ./semantic」 | 1 | 无 watchman 的 Metro 看不到新文件；kill 旧 Metro 被权限拒绝 → 另起 `expo start --port 8083 --clear` + `QUIESCO_METRO_URL` |
| 6.2 Web：拖拽无效果（纯 Playwright 也复现） | 1 | RNW 在出现文本选择时终止 responder；示例拖拽区加 userSelect none + 拒绝终止请求（App 侧问题） |
| 6.2 Web：scrollToIndex 抛 invariant | 1 | RNW 自带的 VirtualizedList 字段为 `_highestMeasuredFrameIndex`；兼容并加按屏滚动兜底 |
| 6.2 iOS：指定点点击误报 ELEMENT_OBSCURED | 1 | Fabric 挂载层级与 React 层级不同 → 原生返回 hitTags + 新增 hitAt，JS 按 React 子树判断 |
| 6.2 iOS：拖拽后回到待办列表 | 1 | iOS 26 内容区右滑返回；playground 关闭 gestureEnabled（App 侧问题，真实用户同样会遇到） |
| 6.2 iOS / Android：scrollToEdge 超时 | 2 | 慢速拖动 → 快速甩动；每步独立超时 + 最终等待独立超时 + Host 等待放宽 |
| 6.2 iOS：修复后仍是旧行为 | 1 | 临时 Metro 带 CI=1 → 无文件监听；去掉 CI=1 重启并确认 bundle |
| 6.2 Android：一次 BeforeAll 17 分钟后失败 | 1 | 未复现（紧接着重跑 15/15，1m58s）；发生在 Metro 重启后首次打包 Android bundle 期间，原因未确认 |
| 6.3 iOS：滚轮各列 x 范围互相重叠 | 2 | UIPickerColumnView 铺满整个 picker 且用 3D 变换排布，frame / convert 不可用 → 沿选中带逐点 hitTest 归属到列 |
| 6.3 iOS：日期列拖 8 行无反应 | 1 | 拖动距离超过 picker 高度，起点落在 picker 外 → 起点固定在滚轮内靠边，终点可出界 |
| 6.3 iOS：adjustSlider 不收敛（0.72 → 0.88 → 0.78…） | 3 | iOS 26+ 滑块：短距离 / 反向拖动丢失位移（触摸 slop）→ 每次单向拖动 + 助跑（不足时先单独拉开），按读回误差学习 slop；容差定为一档（拖动落在像素上，精确值用 setValue） |
| 6.3 Android：分段控件找不到 testID | 1 | segmented-control 的 JS 实现（Android / Web）不传 testID → 示例用 View 包 testID；detectControl 增加「容器内唯一控件」 |
| 6.3 Android：increment 不触发 | 2 | performAccessibilityAction 返回值不可靠（adjustable 走 super → false），且 RN 的 id→名称表只在 onInitializeAccessibilityNodeInfo 时填充 → 先 createAccessibilityNodeInfo，不再看返回值（JS 侧确认有 onAccessibilityAction） |
| 6.3 Web js 档位：App 崩溃（e.getFullYear） | 1 | DOM date input 外层的 App 自有包装组件（value: Date + onChange(date)）被当成 datetimepicker 调用 → DOM `<input>` 一律按 DOM 控件处理 |
| 6.3 Web 单测：fill 到非表单元素卡 30s | 1 | Playwright 会等待可编辑 → provider 先检查标签（SELECT / INPUT / TEXTAREA），否则立即报错 |
| 6.4 三端：捏合 / 旋转读数系统性偏小（iOS 1.76、Android 1.46、Web 1.19 对 2 倍） | 1 | 识别器从激活点计量（源码确认阈值）→ 先做与平台阈值相等的 lead-in；阈值放在各 DeviceProvider（gestureSlop），经 hello 下发，可由 actions.gestureSlop 覆盖；实测微调 Android 26 dp、Web 46 px / 旋转 0 |
| 6.4 Web 单测：两指按下得到 touchstart:1 + touchstart:2 | 1 | CDP 对每个变化触点各发一个 DOM 事件（与真实触摸屏一致），修正测试预期 |
| 6.5 spike：iOS 原生模块 OnCreate 里创建 LinkingAppDelegateSubscriber 崩溃（EXC_BREAKPOINT） | 1 | app-delegate subscriber 是 @MainActor，OnCreate 不在主线程 → `DispatchQueue.main.async`；实测仍早于 expo-router 首次读取 |
| 6.5 Web 实跑：terminate 后 tap 等了 30 s 重连才失败 | 1 | action() 先调 mode() 读连接，状态检查在 call() 里太晚 → checkAppRunning 前移到 action()；新增 Driver 直测（连接永不返回），反向测试：去掉修复后超时失败 |
| 6.5 iOS xcodebuild：「Scanning for @ExpoModule classes didn't complete」 | 1 | 与 Android `prebuild --clean` 同时跑导致；Android 构建结束后重试即成功（两端构建不要并行） |
| 6.6 Web 实跑：深色模式下页面 useColorScheme 不更新（agent 读回却是 dark） | 1 | 读回用的 `Appearance.getColorScheme()` 读的是 react-native-web 监听的同一个 MediaQueryList，读 `matches` 会更新它记住的状态，Chromium 随后不再派发 change 事件 → agent 改为在有 matchMedia 时新建 MediaQueryList 读取（readColorScheme + 单测）；修复前该场景失败即反向证据 |
| 6.6 Web 实跑：新方法报 ACTION_NOT_SUPPORTED | 1 | `@quiesco/web` 从 dist 加载，未重建；`pnpm -r build` 后正常（原生 / web 包改动后先构建再实跑） |
| 6.6 Android 实跑：放大字号之后 11 个场景连锁失败（router.push 报 imperative router unavailable before first render） | 1 | 字号 / 语言变化重建 Activity，React 根在同一 JS context 内重挂载，expo-router 58 的命令式路由失效且软重置救不回 → Android setFontScale / setLocale 及其恢复都保留数据重启 App（与 iOS / Web 的 locale、Android 撤销权限一致）；会话结束时也恢复设备状态（不重启） |
| 6.6 Android 首次实跑：App 30 s 内未连接 | 1 | 原因未定位（重跑即正常；当时 Metro 冷启动 + 新原生依赖）；若再现需看完整诊断（之前被 grep 过滤） |
| 6.6 Android 实跑：「模拟定位」后所有场景超时，模拟器看似无动静 | 1 | expo-location getCurrentPositionAsync 触发 Google Play 服务「Location Accuracy」系统对话框盖住 App → 示例改 `mayShowUserSettingsDialog: false` + `Accuracy.High`（GPS，geo fix 喂的是 GPS；新模拟器无网络定位）。系统对话框的通用处理属 6.7 |
| 6.6 Android：模拟器连续运行 7 小时后 App 启动到 JS 运行 26 s，连接超时 | 1 | 主机负载 ~7 + 模拟器老化；经 HU 同意 `adb emu kill` 后由 QUIESCO_AVD 冷启动，全量 3m35s |
| 6.6 Web 桌面：「上一个场景的横屏已恢复」断言 portrait 失败 | 1 | 桌面视口本身横向，Quiesco 恢复到配置视口是对的 → 示例改为与首次打开时的方向比较 |

