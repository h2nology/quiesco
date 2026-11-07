# Task Plan: Quiesco —— Expo 用 E2E 灰盒测试工具（iOS / Android / Web，Cucumber 驱动）

## Goal
按 `requirements.md` 第 10 节的 6 个阶段，交付 Quiesco monorepo：三端灰盒同步 + Cucumber 驱动，示例 App 的第 9 节场景在 iOS Simulator、Android Emulator、Chromium 上用同一份 feature 通过。

## Next Step
S7：Web 端 Fiber 查询。在 Chromium 上运行 spike（Metro dev server + 静态导出两种），验证 hook 自装（react-dom）、按 testID（React props）找宿主 DOM 节点、getBoundingClientRect 坐标与 Playwright 实测一致，以及 S2 的 scheduler 替换在 react-dom 上是否有效。

## Current Phase
Phase 0

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
- [ ] S7 Web 端 Fiber 查询：react-dom + react-native-web 下同一 fiber-adapter 接口按 testID 找宿主 DOM 节点并取坐标，确认 testID 映射 → `docs/spikes/07-web-fiber-query.md`
- [ ] 0.9 汇总：给出最低支持 Expo SDK 版本建议（§11-2，交 HU 决定）、Expo Go / JS-only 可行性结论、对第 1 阶段设计的影响
- **验收：** 7 份结论文档；1〜5、7 的验证代码可运行
- **Status:** in_progress

### Phase 1: 核心闭环（Android + JS 档位）
- [ ] monorepo 骨架（pnpm workspaces、TS strict、lint、单测框架、dependency-cruiser 规则）
- [ ] `@quiesco/protocol`：JSON-RPC 类型、方法、错误码、协议版本
- [ ] `@quiesco/agent`：fiber-adapter（RN）、Query/Matcher、全部 IdleTracker（network/timer/react/idle-callback/frame-stable）、JS 档位动作、断言、QuiescoRoot
- [ ] `@quiesco/core`：WS Server、Driver、会话 API（运行器无关）、Android DeviceProvider、defineConfig
- [ ] `@quiesco/cucumber`：World + hooks（register）
- [ ] `examples/todo-app` + 第 9 节 feature 与 step definitions + 本地 mock server
- **验收：** Android Emulator + dev client 第 9 节场景通过；注入 2s 网络延迟与 1s 动画后无需改测试仍稳定通过；同步超时错误能指出具体请求/定时器
- **Status:** pending

### Phase 2: 真实触摸与速度（Android）
- [ ] `@quiesco/native` Android 实现 + native 动作档位
- [ ] 软重置、后门、onReset 钩子
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
| 2 | 最低支持 Expo SDK | Phase 0 结束时给建议 | 未决 |
| 3 | iOS 注入替代方案（若 S4 失败） | S4 结论后 | 不需要（S4 成功） |
| 4 | CI：GitHub Actions / EAS Workflows | Phase 1 搭骨架时（依赖检查要进 CI） | 未决 |
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
| §6.2-4 改为 `idle-callback` tracker：跟踪挂起的 requestIdleCallback，旧版本兼容 InteractionManager；requirements.md 已同步 | RN 0.88 移除 InteractionManager；HU 2026-11-07 确认 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Android 截图全黑，App 不渲染 | 1 | 屏幕休眠 + ACCESS_LOCAL_NETWORK 授权弹窗挡住；唤醒 + `pm grant` 解决 |
| `adb shell am start -d` 的 URL 参数丢失 | 1 | `&` 被设备端 shell 解析；需要再加一层引号（待在 DeviceProvider 中处理） |
| `expo run:ios -d <udid>` 失败：`connect ENOENT /var/run/usbmuxd` | 1 | Expo CLI 解析设备时会枚举物理设备，本机没有 usbmuxd；改用 `xcodebuild -sdk iphonesimulator` + `simctl install`（也是 iOS DeviceProvider 的路线）。注意：后台命令用了 `| tail`，退出码被吞掉，以后加 `set -o pipefail` |
| S2 测量出「定时器延迟 500ms」 | 1 | 加 scheduler 运行日志定位：测试代码 `Slow` 组件未 memo 导致长渲染，非 RN 问题 |
| S6 用副本验证原生剔除：两种模式都没有模块 | 1 | 副本的 node_modules 是符号链接，autolinking resolve 过滤掉了本地模块 → 改在主项目上 prebuild --clean |
| S6 用 dexdump 按类名检查，对照组也是 0 | 1 | R8 混淆了包名 → 改为检查 Module 名称字符串 |
| 轮询脚本超时卡住 | 2 | `uiautomator dump` 不返回、macOS 无 `timeout`；改为截图确认 |
