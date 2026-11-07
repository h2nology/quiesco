# 第 0 阶段汇总

- 日期：2026-11-07
- 验证环境：Expo SDK 58.0.23 / React Native 0.88.1 / React 19.3.0（New Architecture，Fabric）；Android Emulator API 37；iPhone 17 Simulator / iOS 27.0（Xcode 27.2）；Chromium（playwright 1.65.0）
- 验证代码：`spikes/spike-app/`（Expo App + 本地 Expo Module `modules/spike-touch`）、`spikes/host/`（Host 侧 WS / Playwright 脚本）

## 1. 结论一览

| # | 主题 | 结论 | 文档 |
|---|---|---|---|
| S1 | 原生端 Fiber 查询 | ✅ 通过 DevTools hook 拿到根 Fiber（debug 构建包装已有 hook，release 构建自行安装），按 testID 找宿主组件，`getBoundingClientRect()` 同步取坐标，误差 ≤ 1px | [01](01-fiber-query.md) |
| S2 | React 空闲检测 | ✅ root 字段（A）**且** scheduler 挂起任务（B，替换 `scheduler` 导出函数）；并且必须**跨宏任务两次确认**。6 个场景 × 4 种环境误判 0 | [02](02-react-idle.md) |
| S3 | Android 触摸注入 | ✅ `MotionEvent` → `Activity.dispatchTouchEvent`（公开 API），Pressable / 按下态 / RNGH 都正常 | [03](03-android-touch.md) |
| S4 | iOS 触摸注入 | ✅ 合成 `UITouch` + `UIEvent` + `IOHIDEvent`（私有 API，仅 e2e 构建），`UIApplication.sendEvent:`。**§11-3 的替代方案不需要** | [04](04-ios-touch.md) |
| S5 | 连接参数传递 | ✅ iOS 用进程启动参数，Android 用 Intent extras，Web 用 `addInitScript`；不使用深链接 | [05](05-connection-params.md) |
| S6 | 生产剔除 | ✅ JS：Metro resolver 替换为桩（`withQuiesco`）；原生：config plugin 在非 e2e 的 prebuild 时注入 autolinking exclude | [06](06-prod-strip.md) |
| S7 | Web 端 Fiber 查询 | ✅ 同一套代码在 react-dom + RNW 上可用（dev / 静态导出都通过），坐标与 Playwright 完全一致 | [07](07-web-fiber-query.md) |

**需求变更（已获 HU 确认）**：RN 0.88 移除了 `InteractionManager`，§6.2 第 4 项改为 `idle-callback` tracker（跟踪 `requestIdleCallback`，在旧版本上兼容 InteractionManager）。

## 2. 对 Phase 1 设计的影响

### agent（`@quiesco/agent`）

1. **入口顺序**：DevTools hook 和 scheduler 替换必须在渲染器加载之前完成。要求用户把 agent 放在入口第一行 import（`quiesco init` 自动处理）。agent 要检测「装得太晚」的情况：已有渲染器注入，或者 `scheduledTotal` 一直为 0，此时明确报错。
2. **fiber-adapter 的平台差异只有 3 点**（其余代码三端共用）：
   - 宿主 Fiber 上 testID 的 prop 名：`testID`（Fabric）/ `data-testid`（RNW）。
   - 文本：HostText Fiber，加上没有子 Fiber 的宿主元素的 `props.children`（react-dom）。
   - 取坐标的对象：`getPublicInstanceFromInternalInstanceHandle(fiber)`（Fabric）/ `fiber.stateNode`（DOM）。两者都调用 `getBoundingClientRect()`。
3. **查询范围**：dev client 会叠加自己的视图 ⇒ 遍历范围限定在 `QuiescoRoot` 的子树内。
4. **Sync**：
   - React tracker = A && B（S2）。
   - **所有 tracker 统一「跨宏任务两次确认」**，用来应对定时器批量执行、microtask 尚未清空的情况。
   - timer tracker 是必需的（S3：Pressability 的 `minPressDuration` 通过 setTimeout 实现）。
   - JS 线程被长任务阻塞时，agent 无法响应 ⇒ Host 侧按墙上时间计算超时，并在错误信息中给出提示。
5. **私有路径**：`react-native/Libraries/Renderer/shims/ReactFabric` 的深层 import 在 RN 0.88 中有弃用警告 ⇒ 只在 fiber-adapter 中 import，并自己写类型声明；启动时校验 `rendererPackageName` / `version`。
6. **JS-only 模式下的连接参数**：没有原生模块时，读不到启动参数。agent 在 node_modules 中又读不到 `EXPO_PUBLIC_*`（S6）⇒ 由 `withQuiesco` 生成虚拟模块来注入构建期的兜底端口（只支持单个 worker）。

### core（`@quiesco/core`）

1. Android DeviceProvider 的 `boot` / `launch`：唤醒屏幕、`svc power stayon true`、`pm grant … ACCESS_LOCAL_NETWORK`（失败时忽略）、`adb reverse`、`am start … --es quiescoPort … --es quiescoSession …`（整个参数要加引号）。dev client 的 URL 带上 `__expo_disable_onboarding=1&__expo_disable_fab=1`。
2. 连接等待：从启动到收到 hello 实测 2.4–3.9 秒 ⇒ 超时设为 30 秒左右，超时时给出排查提示。
3. 不要依赖 `uiautomator dump`（在 RN 画面上可能不返回）。

### 构建与发布

- e2e 的判定统一使用 `EXPO_PUBLIC_QUIESCO=1`（Metro 构建时与 prebuild 时）。
- CI 的生产剔除检查，要使用**不会被混淆的字符串**作为特征（Android release 默认开启 R8）。

## 3. 最低支持的 Expo SDK（§11-2，**请 HU 决定**）

静态检查（npm 包源码）：

| SDK | RN | React | 关键 API（getBoundingClientRect / public instance / DevTools 注入 / 初始化时读取 scheduler） | InteractionManager |
|---|---|---|---|---|
| 55 | 0.83.10 | 19.2.0 | 全部存在 | 有 |
| 56 | 0.85.3 | 19.2.3 | 全部存在 | 有 |
| 57 | 0.86.3 | 19.2.3 | 全部存在 | 有 |
| 58 | 0.88.1 | 19.3.0 | 全部存在（**运行时已验证**） | 无 |

- SDK 55 起强制启用 New Architecture，与需求「只支持 New Architecture」一致；SDK 54 及以下需要额外处理旧架构，不考虑。
- 运行时验证只做了 SDK 58。

**建议**：第一版的最低支持定为 **SDK 58**（已验证，符合需求「支持开发时最新的稳定 SDK」）。Phase 4 搭好 CI 后，在 SDK 55–57 上运行冒烟测试，通过的话再把最低版本下调到 55。从静态检查看，下调的风险较低。

## 4. Expo Go / JS-only 模式

- **JS-only（不安装原生模块）**：查询（S1/S7）和空闲检测（S2）都是纯 JS，不依赖原生模块；动作走 `js` 档位。连接参数需要用构建期兜底（见 §2 agent 第 6 点）⇒ **在 dev client 上可行**（Phase 1 本来就是这种配置）。
- **Expo Go**：支持 SDK 58 的新版 Expo Go 尚未在商店上架（Expo 官方升级指南），**没有验证**。原则上纯 JS 的 agent 可以运行，但 Expo Go 中无法使用自定义 Metro 配置以外的手段传递参数，需要在新版 Expo Go 上架后再验证。文档中暂时写「未验证」。

## 5. 未完成 / 遗留事项

| 事项 | 处理时机 |
|---|---|
| RN `Modal`（Android 上是独立的 Dialog 窗口）的触摸注入 | Phase 2 |
| 滑动 / 滚动 / 多指的注入（iOS 需要 Moved 阶段） | Phase 2（Android）/ Phase 4（iOS） |
| iOS release 构建的连接（依据配置判断可行，未实测） | Phase 4 |
| Android `ACCESS_LOCAL_NETWORK` 在 targetSdk 37 下的行为 | Expo 将 targetSdk 提到 37 时 |
| Web：整页跳转后重新连接、Expo Router hydration 等待 | Phase 3 |
| Expo Go 上的运行 | 新版 Expo Go 上架后 |
