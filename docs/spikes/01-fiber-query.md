# Spike 1：原生端 Fiber 查询

- 日期：2026-11-07
- 环境：Expo SDK 58.0.23 / React Native 0.88.1 / React 19.3.0（New Architecture，Fabric）
  - Android：Emulator API 37（`Medium_Phone_API_37.0`），debug（dev client）与 release 两种构建
  - iOS：iPhone 17 Simulator / iOS 27.0，debug（dev client）
- 验证代码：`spikes/spike-app/spike/`（`devtools-hook.ts`、`fiber-query.ts`、`measure.native.ts`、`s1-report.ts`），入口 `spikes/spike-app/index.ts`

## 结论

**可行。** 不依赖任何原生代码，只用 JS 就能拿到根 Fiber，按 testID 找到宿主组件，并同步取得屏幕坐标。debug 与 release 构建、Android 与 iOS 都已实测通过。

| 项目 | 结果 |
|---|---|
| 获取 renderer 与根 Fiber | ✅ 通过 `__REACT_DEVTOOLS_GLOBAL_HOOK__` |
| 按 testID 找宿主组件 | ✅ 4/4 命中（Android / iOS / Android release） |
| 读取文本、role | ✅ |
| 屏幕坐标 | ✅ 同步 API，与截图误差 ≤ 1px |

## 1. 获取 renderer 与根 Fiber

渲染器（`react-native/Libraries/Renderer/implementations/ReactFabric-{dev,prod}.js`）在**模块初始化时**检查全局的 `__REACT_DEVTOOLS_GLOBAL_HOOK__`：

- 条件为 `!hook.isDisabled && hook.supportsFiber`，满足时调用 `rendererID = hook.inject(internals)`。
- 之后每次提交时调用 `hook.onCommitFiberRoot(rendererID, root, priority, didError)`，执行完被动 effect 后调用 `hook.onPostCommitFiberRoot(rendererID, root)`，调度更新时调用 `hook.onScheduleFiberRoot(rendererID, root, children)`。
- **prod 构建同样保留了这段注入逻辑**，只是去掉了 dev 版的报错。

谁安装 hook，取决于构建类型：

| 构建 | hook 是否存在 | agent 的做法 | 实测 |
|---|---|---|---|
| debug | 存在。由 `Libraries/Core/setUpReactDevTools.js` 在 `__DEV__` 下调用 `react-devtools-core` 的 `initialize()` 安装，时机在 InitializeCore 中、早于 React 加载 | **包装**已有 hook 的 `inject` / `onCommitFiberRoot` / `onPostCommitFiberRoot` / `onScheduleFiberRoot`，再调用原函数。不能覆盖，否则会破坏 React DevTools | `hookSource=existing`，`bundleType=1` |
| release | 不存在 | **自行安装最小 hook**（`supportsFiber: true`、`inject`、`onCommitFiberRoot` 等） | `hookSource=installed`，`bundleType=0` |
| Web（参考 S7） | 不存在（除非装了浏览器扩展） | 同 release | — |

**安装时机：** 入口文件第一行 import agent 就足够早。Fabric 渲染器在 `AppRegistry` 首次渲染时才懒加载，晚于入口模块的执行（release 实测通过）。

**根 Fiber：** 在 `onCommitFiberRoot` 中把 `root`（FiberRoot）按 rendererID 放进 Set，`root.current` 就是当前的根 Fiber。

## 2. 遍历与匹配

- 从 `root.current` 出发，沿 `child` / `sibling` 深度优先遍历。
- 宿主组件：`fiber.tag === 5`（HostComponent）。文本节点：`fiber.tag === 6`（HostText，`memoizedProps` 是字符串）。React 19 的 WorkTag 值见 `ReactWorkTags.js`；react-dom 还会用到 `26`（HostHoistable）和 `27`（HostSingleton），在 RN 中不出现。
- props 从 `fiber.memoizedProps` 读：`testID`、`accessibilityRole` / `role`、`accessibilityLabel` 等。
- 文本内容：收集子树中所有 HostText 的 `memoizedProps` 拼接而成。

实测的宿主类型（Android 与 iOS 相同）：

| 组件 | 宿主 `fiber.type` |
|---|---|
| `View`、`Pressable` | `RCTView` |
| `Text` | `RCTText` |
| RNGH `RectButton` | `RNGestureHandlerButton` |

宿主节点数：debug 为 16，release 为 13。差值来自 dev client 的叠加视图，⇒ 查询结果需要排除不属于用户 App 根的节点（在 Phase 1 用 `QuiescoRoot` 限定遍历范围即可）。

## 3. 屏幕坐标

```ts
const ReactFabric = require('react-native/Libraries/Renderer/shims/ReactFabric').default; // 注意 .default
const el = ReactFabric.getPublicInstanceFromInternalInstanceHandle(fiber); // ReactNativeElement
const rect = el.getBoundingClientRect(); // 同步，DOM 风格
```

- `ReactNativeElement`（`src/private/webapis/dom/nodes/ReactNativeElement.js`）是 New Architecture 下 DOM 风格的公开实例，提供同步的 `getBoundingClientRect()`。
- `measureInWindow(cb)` 的回调同样**同步**执行，结果与 `getBoundingClientRect()` 相同。
- 单位：Android 为 dp，iOS 为 pt。原点在窗口左上角（edge-to-edge，包含状态栏）。换算成像素用 `PixelRatio.get()`（Android 2.625，iPhone 17 为 3）。

与截图对比：

| 平台 | 元素 | 逻辑坐标 | 换算像素 | 截图实测 |
|---|---|---|---|---|
| Android | Pressable | (150.48, 407.62) 110.86×43.43 dp | (395, 1070) 291×114 | (396, 1070)–(685, 1183) |
| iOS | "Native module: ios" | y=361, h=17 pt | 1083–1134 | 文字中心约 1107 |

**这对架构的意义：** Web 端也用 `getBoundingClientRect()` 取坐标（CSS 像素），因此 fiber-adapter 的「取坐标」接口在三端可以是同一个形态，平台差异只在于「如何从 Fiber 得到可调用 `getBoundingClientRect()` 的对象」。

## 4. 需要在 Phase 1 处理的风险

1. **私有路径依赖**：`react-native/Libraries/Renderer/shims/ReactFabric` 和 Fiber 的 `tag`、`memoizedProps`、`child`、`sibling` 都是内部实现，按设计原则全部集中到 `packages/agent/src/fiber-adapter/`。启动时应校验 `rendererPackageName` / `version`，遇到未知版本时给出明确警告。
2. **hook 安装顺序**：要求用户把 agent 放在入口第一行 import（或由 `QuiescoRoot` 所在模块的副作用完成）。如果渲染器已经先加载，就拿不到 root ⇒ agent 要检测「hook 安装时渲染器已注入」的情况并报错。
3. **dev client 叠加视图**：查询范围要限定在用户 App 的子树内。
4. **TypeScript 类型**：RN 没有为渲染器 shim 发布类型声明，需要自己写最小声明。
