# Task Plan: Quiesco —— Expo 用 E2E 灰盒测试工具（iOS / Android / Web，Cucumber 驱动）

## Goal
按 `requirements.md` 第 10 节的 6 个阶段，交付 Quiesco monorepo：三端灰盒同步 + Cucumber 驱动，示例 App 的第 9 节场景在 iOS Simulator、Android Emulator、Chromium 上用同一份 feature 通过。

## Next Step
4.5 完成（未提交；示例 App src/e2e.ts 的临时探针不提交），待 HU 确认后进入 4.6（cucumber --parallel）。

## Current Phase
Phase 4

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
- [ ] 3.6 「只测原生端不装 Playwright 也能运行」的验证：用 Node 的 module hook 在加载 `playwright` / `@quiesco/web` 时直接抛错，带着它跑一次 Android 全量 feature
- [ ] 3.7 验收：同一份 feature 与 step 在 Android Emulator 与 Chromium（手机 / 平板 / 桌面三视口）上都通过；Web 每个视口连续 20 次无随机失败；3.6 通过；`pnpm run check` 通过
- **Status:** in_progress（HU 2026-11-08 确认计划）

### Phase 4: iOS 与 Expo 集成
**范围**：`@quiesco/native` iOS 实现、iOS DeviceProvider、`@quiesco/expo-plugin`（从 native 包迁出并补 iOS）、`eas.json` e2e profile、生产剔除检查、cucumber `--parallel`。环境：Xcode 27.2，iPhone 17 / iOS 27.0（另有 iOS 26.5 runtime）。

**任务拆分（按顺序）**
- [x] 4.0 原生验证（spike 未覆盖的 4 项，临时代码，结论记 findings）：① Fabric 下 view tag → `UIView`（`RCTComponentViewRegistry` / `RCTSurfacePresenter`）与窗口坐标；② Modal（同一窗口内 present 的 VC）遮挡判定：目标点 `hitTest` 结果是否是目标 view 的子孙；③ 中文输入：聚焦后 `UITextInput insertText:` / `replaceRange:` 触发 onChangeText；④ swipe / 滚动：Moved 阶段 HID 事件 + ScrollView 惯性；⑤ 进程内 openUrl（不经 `simctl openurl`，避免 SpringBoard 确认框）
- [x] 4.1 `@quiesco/native` iOS：Swift Module + ObjC `QSTouchInjector`（私有 API 调用前 `respondsToSelector:` 检查，不满足报 `NATIVE_UNSUPPORTED` 并建议 js 档位）；与 Android 相同的 JS 接口：`getLaunchParams` / `locate` / `tap` / `swipe` / `typeText`，新增 `openUrl`；`expo-module.config.json` 加 `ios`；podspec 链接 IOKit
- [x] 4.2 agent：坐标无需平台分支（原生侧直接返回窗口坐标 pt / dp）；`openUrl` 在原生模块具备 `openUrl` 能力时于 App 内打开（按能力判断，不按平台）；`pressBack` 仍交给 Host，由 4.4 的 iOS provider 报 `ACTION_NOT_SUPPORTED` 并提示改用业务返回操作（§12：平台分支留在 provider）
- [x] 4.3 `@quiesco/expo-plugin`：把 `packages/native/app.plugin.js` 迁入并补 iOS ——非 e2e：Podfile 注入 `use_expo_modules!(exclude: ['@quiesco/native'])`；e2e：确认 ATS `NSAllowsLocalNetworking`；dev client 启动参数常量共用。示例 App 改用 `"@quiesco/expo-plugin"`；单元测试覆盖两种模式的 Podfile / settings.gradle / manifest 结果
- [x] 4.4 core `IosProvider`（`xcrun simctl`）：按名称 / UDID / runtime 选模拟器，`boot` + `bootstatus -b`；`install` .app；`launch` 用进程参数 `-quiescoPort/-quiescoSession`，dev client 用 `--initialUrl`（带 `__expo_disable_onboarding/fab/auto_launch`）；`terminate`、`privacy grant` 权限映射（不支持的给警告）、`io screenshot`、硬重置（terminate + 清 App 容器 / 重装）；连接超时诊断。单元测试用假 exec 校验命令
- [x] 4.5 示例 App：`ios` 配置与 `build:ios`（simulator Debug dev client）/ `test:e2e:ios` 脚本；`eas.json` 的 `e2e` profile（iOS simulator build、Android APK、`EXPO_PUBLIC_QUIESCO=1`）
- [ ] 4.6 cucumber `--parallel`：worker N 用端口 base+N（已有）＋各自的设备（iOS：`simctl clone` 出 worker 专用模拟器；Android：`devices.android.serials[]` / 多 AVD；Web：独立 browser）；示例 mock 后端每 worker 一个端口（3001+N），App 通过 e2e backdoor `setApiBase` 切换（Android 对应 `adb reverse`）
- [ ] 4.7 生产剔除检查脚本 `scripts/check-prod-strip.mjs`：生产模式 `expo export --platform all` 后在 JS / Hermes 字节码中 grep agent 特征串；iOS Release simulator 构建后 `nm` 查 `QSTouchInjector`、`IOHIDEventCreateDigitizerEvent`；Android release APK 查 `QuiescoNative`（R8 不混淆的 Module 名）；带 e2e 对照组。接入哪个 CI 由 §11-4 决定
- [ ] 4.8 验收：iOS / Android / Chromium 三端 6 场景通过；iOS 连续 20 次；生产剔除检查通过（含对照组）；2 worker 并行 vs 串行耗时（iOS、Android、Web 三端实测）记入 `docs/benchmarks.md`；`pnpm run check`
- **验收：** 三端通过；生产构建检查通过；2 worker 并行明显快于串行（记录数据）
**HU 决定（2026-11-08）**：§11-4 GitHub Actions（再次确认；iOS 检查跑 macos runner）；并行验收三端都实测（含本机同时运行两台 Android Emulator）。
- **Status:** in_progress

### Phase 5: 易用性与周边
- [ ] CLI：init / test / doctor / tree
- [ ] 权限预授权、键盘处理
- [ ] `@quiesco/steps` 可选通用步骤
- [ ] 文档：README、API 参考、同步机制、三端差异、故障排查、Driver 模式
- **验收：** 全新 create-expo-app 项目按 README 10 分钟内在任一平台跑通首个场景
- **Status:** pending

## 待 HU 决定（requirements.md §11，遇到时暂停询问）
| # | 事项 | 何时需要 | 状态 |
|---|------|---------|------|
| 1 | 开源许可证 | 发布前（Phase 5 前即可） | 未决 |
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
