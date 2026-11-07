# Task Plan: Quiesco —— Expo 用 E2E 灰盒测试工具（iOS / Android / Web，Cucumber 驱动）

## Goal
按 `requirements.md` 第 10 节的 6 个阶段，交付 Quiesco monorepo：三端灰盒同步 + Cucumber 驱动，示例 App 的第 9 节场景在 iOS Simulator、Android Emulator、Chromium 上用同一份 feature 通过。

## Next Step
1.4 `@quiesco/agent` 上层：WS 连接（hello / 重连）→ JS 档位动作 → 断言（agent 端重试到超时）→ `QuiescoRoot`（install 顺序、setScope、checkRendererSeen、组装 trackers）→ `withQuiesco` / `stub`。

## Current Phase
Phase 1

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
- [ ] 1.4 `@quiesco/agent` 上层：WS 连接（hello、重连）、JS 档位动作（tap / longPress / doubleTap → onPress 等；type / clear → onChangeText；scroll / scrollTo / swipe 的 JS 实现；dismissKeyboard）、断言（expectVisible / NotVisible / Exists / NotExists / Text / Prop / Count，在 agent 端反复检查直到超时）、`QuiescoRoot`（安装 tracker、根 key）、`withQuiesco`（Metro：非 e2e 替换为桩；注入构建期兜底端口的虚拟模块）、`stub` 入口
- [ ] 1.4b 后门与软重置的**最小实现**（HU 2026-11-07 决定提前）：`quiesco.backdoor()` 注册与调用（JSON 可序列化校验、未注册时列出已注册名称、执行后等待空闲）、`quiesco.onReset()`、软重置（清 AsyncStorage → onReset 钩子 → 根 key 更换 → 等待空闲）
- [ ] 1.5 `@quiesco/core`：WS Server（多连接、session 校验、协议版本检查）、会话 API（运行器无关：createSession / beforeScenario / collectEvidence / dispose）、Driver（6.3〜6.6 的 async API）、DeviceProvider 接口 + Android 实现（boot：唤醒/stayon；install；launch：pm grant、adb reverse、am start 带 extras 与 dev client URL；terminate；screenshot；shutdown）、`defineConfig` 与配置加载、连接等待超时与排查提示
- [ ] 1.6 `@quiesco/cucumber`：World（`this.app`）、hooks（BeforeAll / Before / After / AfterAll）、`register` 入口
- [ ] 1.7 `examples/todo-app`：Expo SDK 58 + Expo Router（登录页、待办列表、新建待办表单、带动画的页面切换）、本地 mock server（可配置延迟）、`features/` 第 9 节 feature + step definitions、`quiesco.config.ts`
- [ ] 1.8 验收：
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
- **Status:** in_progress

### Phase 2: 真实触摸与速度（Android）
- [ ] `@quiesco/native` Android 实现 + native 动作档位
- [ ] 软重置、后门、onReset 钩子的完善（Phase 1 已有最小实现）：存储适配器（MMKV / SecureStore，可由用户注册）、性能调优（目标 < 500ms）
- [ ] 失败时附加截图与元素树
- [ ] 性能基准脚本 → `docs/benchmarks.md`
- **验收：** native 档位通过；连续 20 次无随机失败；基准记录在案
- **Status:** pending

### Phase 3: Web
- [ ] `@quiesco/web`：Web DeviceProvider、Playwright 输入注入、静态文件服务器（SPA 回退）
- [ ] fiber-adapter 的 react-dom 实现、Web 存储适配器、hydration 等待、整页刷新透明重连
- [ ] 平台 tag 过滤与 `--platform` 切换
- **验收：** Android 与 Chromium 用完全相同的 feature/steps 通过；Web 连续 20 次无随机失败；不装 Playwright 时原生端正常
- **Status:** pending

### Phase 4: iOS 与 Expo 集成
- [ ] `@quiesco/native` iOS 实现、iOS DeviceProvider
- [ ] `@quiesco/expo-plugin`、`eas.json` e2e profile 示例
- [ ] 生产剔除 CI 检查（需 HU 决定 CI 环境，§11-4）
- [ ] cucumber `--parallel` 支持
- **验收：** 三端通过；生产构建检查通过；2 worker 并行明显快于串行（记录数据）
- **Status:** pending

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
| 6 | Web 是否首版验收 Firefox/WebKit | Phase 3 前 | 未决 |
| 7 | Web 视口默认值（手机/桌面/两者） | Phase 3 前 | 未决 |

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
