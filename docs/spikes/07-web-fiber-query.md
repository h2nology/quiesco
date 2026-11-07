# Spike 7：Web 端 Fiber 查询

- 日期：2026-11-07
- 环境：Expo SDK 58.0.23 / React 19.3.0 / react-dom 19.3.0 / react-native-web 0.21.4 / RNGH 3.3.0；Chromium headless shell（playwright 1.65.0），视口 390×844
- 被测对象：
  1. Metro dev server（`http://localhost:8081`，dev 构建）
  2. 静态导出（`EXPO_PUBLIC_QUIESCO=1 npx expo export --platform web`，prod 构建，用 `python3 -m http.server` 托管）
- 验证代码：与原生端共用 `spikes/spike-app/spike/`（`devtools-hook.ts`、`scheduler-tracker.ts`、`fiber-query.ts`、`measure.web.ts`、`s1-report.ts`、`s2-run.ts`）；Host 侧为 `spikes/host/s7-web.mjs`（Playwright，收集页面日志并用 `boundingBox()` 对照）

## 结论

**可行。同一套 hook、遍历和空闲判定代码在 react-dom 上直接可用。** fiber-adapter 只需要在下面三点上区分平台：

| 差异点 | Fabric（iOS / Android） | react-dom + RNW（Web） |
|---|---|---|
| 宿主 Fiber 上 testID 的 prop 名称 | `testID` | `data-testid`（RNW 把它转换后传给 DOM 元素）。`testID` 只留在 RNW 的复合组件上 |
| 宿主元素的文本 | 一定会生成 HostText Fiber（`tag === 6`） | 当 children 是单个字符串时**不生成** HostText，文本留在宿主 Fiber 的 `memoizedProps.children` 中（react-dom 的 `shouldSetTextContent`） |
| 取坐标 | `getPublicInstanceFromInternalInstanceHandle(fiber).getBoundingClientRect()` | `fiber.stateNode.getBoundingClientRect()`（`stateNode` 就是 DOM 元素） |

两端的坐标 API 形态相同（都是 `getBoundingClientRect()`），单位分别是 dp/pt 和 CSS 像素，与各自的注入坐标系一致。

## 实测结果

| 项目 | dev server | 静态导出（prod） |
|---|---|---|
| hook | `existing`（Expo Web dev 环境已安装，推测来自 Fast Refresh 运行时）→ 包装 | `installed`（不存在）→ 自行安装 |
| 渲染器 | `react-dom 19.3.0`，`bundleType=1`，rendererID 从 0 开始编号 | `react-dom 19.3.0`，`bundleType=0` |
| 按 testID 查询（4 个） | ✅ 各命中 1 个宿主节点 | ✅ 同左 |
| 文本 | ✅ `Pressable` / `RNGH RectButton` / `Pressable count: 0` / `Native module: web` | ✅ 同左 |
| 坐标与 Playwright `boundingBox()` | ✅ 完全一致（精确到小数，例如 `137.796875, 368.5, 114.390625×41`） | ✅ 完全一致 |
| RNW 在 prod 下是否输出 `data-testid` | ✅ | ✅ |
| S2：scheduler 替换（`schedulerPatched`） | ✅ | ✅ |
| S2：6 个场景 A&&B + 两次确认 | ✅ 误判 0 | ✅ 误判 0 |

宿主元素的类型：Pressable（`accessibilityRole="button"`）和 RNGH RectButton 都是 `button`，Text 是 `div`。

## 查询规则（Phase 1 / Phase 3 的 fiber-adapter）

1. **匹配条件**：`fiber.tag === HostComponent(5)`，并且宿主 Fiber 的 React props 中，`testID`（原生端）或 `data-testid`（Web 端）等于目标值。
   - 这仍然是**以 React props 为准**（宿主 Fiber 的 `memoizedProps`），没有读取 DOM 属性，符合需求 §6.1。
   - **不采用**「在复合组件上找 testID，再取第一个宿主后代」的通用算法：RNGH 的 RectButton 在 Web 上会额外命中一个尺寸为 0 的包装 `div`（实测），产生误匹配。
2. **文本收集**：HostText Fiber 的 `memoizedProps`，加上**没有子 Fiber 的**宿主 Fiber 的 `memoizedProps.children`（字符串或数字）。只在没有子 Fiber 时读取，是为了避免在 Fabric 上重复计数（单个字符串时 Fabric 两处都有，实测修正后原生端没有重复）。
3. **Web 端还会出现 `tag 26`（HostHoistable）和 `27`（HostSingleton，即 `html` / `head` / `body`）**：它们不是可查询的元素，遍历时跳过，但要继续遍历它们的子节点。

## S2 在 Web 上的补充观察

- react-dom 同样通过 `require('scheduler')` 获取调度函数（Web 版 scheduler 基于 MessageChannel 实现），在 react-dom 加载之前替换即可生效。
- Suspense 场景中，B 单独使用时会在 308ms 提前报空闲（此时画面还不正确），A 则正确地报忙到 610ms ⇒ **A 和 B 互补**的结论在 Web 上同样成立。
- Activity 的隐藏子树以 Idle 优先级分时渲染（可以看到连续的 continuation），完成后变为空闲。

## 遗留事项（Phase 3）

- **整页跳转后重新连接**：`addInitScript` 在每次导航时都会重新执行（S5），agent 会重新连接；Host 侧需要透明地等待重连，留到 Phase 3 实现。
- **Expo Router 静态渲染的 hydration 等待**：本次的 spike App 没有使用 Expo Router，留到 Phase 3 用示例 App 验证。
- 只验证了 Chromium（需求 §2.2）。
