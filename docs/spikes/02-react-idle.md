# Spike 2：React 空闲检测

- 日期：2026-11-07
- 环境：Expo SDK 58.0.23 / React Native 0.88.1 / React 19.3.0（Fabric）
  - Android Emulator API 37：debug 与 release
  - iOS Simulator iPhone 17 / iOS 27.0：debug
- 验证代码：`spikes/spike-app/spike/`
  - `scheduler-tracker.ts`：替换 `scheduler` 模块的导出函数，跟踪挂起的任务
  - `react-idle.ts`：判定 A（root 字段）与判定 B（scheduler 挂起任务）
  - `S2Lab.tsx`：测试场景；`s2-run.ts`：运行器与计量
  - 入口 `index.ts` 的 import 顺序：`devtools-hook` → `scheduler-tracker` → 其他

## 结论

**「没有待提交的渲染工作」= 判定 A 与判定 B 同时为空闲，并且在相邻两次、处于不同宏任务中的检查里都成立。**

| 判定 | 内容 | 单独使用时的漏洞（实测） |
|---|---|---|
| A：FiberRoot 字段 | 对 hook 收集到的每个 root：`pendingLanes === 0`、`callbackNode == null`、`cancelPendingCommit == null`、`timeoutHandle === -1`（RN 的 `noTimeout`） | transition / deferred 提交后，被动 effect 还在 scheduler 里排队，A 早报空闲 15–50ms |
| B：scheduler 挂起任务 | 渲染器加载**之前**，替换 `require('scheduler')` 导出对象上的 `unstable_scheduleCallback` / `unstable_cancelCallback`，用 Map 记录挂起的任务；回调返回函数（continuation）表示任务还没结束 | 在组件外调用 setState 后的瞬间，React 还没排任务（它用 microtask 排），B 报空闲 |
| A && B | — | 6 个场景 × 3 种构建，单次检查只出现 1 次误判（iOS 的 Suspense），改成两次确认后为 0 |

## 1. 为什么不用 `onPostCommitFiberRoot`

最初的设想是：「`onCommitFiberRoot` 之后、`onPostCommitFiberRoot` 之前，视为被动 effect 未执行完」。读源码后放弃了：

- `flushSpawnedWork`（`ReactFabric-dev.js` 约 15855 行）只有在存在被动 effect 时，才会把状态设为 `PENDING_PASSIVE_PHASE`，否则根本不会调用 `onPostCommitFiberRoot`。
- dev 构建开着 profiler 时，`actualDuration !== 0` 会强制进入被动 effect 阶段，因此 dev 与 prod 的行为也不一致。

## 2. 为什么替换 scheduler 函数可行

- 渲染器通过 `require("scheduler")` 拿到 scheduler，并在**模块初始化时**读取 `Scheduler.unstable_scheduleCallback` / `unstable_cancelCallback`（`ReactFabric-dev.js` 18068、18201 行）。
- RN 下 `scheduler/index.native.js` 的实现委托给原生的 `nativeRuntimeScheduler`。导出对象是普通对象，可以改写。
- agent 在入口第一行加载，比渲染器更早（S1 已证实），所以替换的版本会被渲染器捕获。实测 `schedulerPatched=true`，debug 与 release 都有效。
- 渲染任务和 `flushPassiveEffects` 都通过它排队，因此 B 能覆盖「渲染中」和「被动 effect 未执行」两种状态。
- Web 端的 react-dom 同样依赖 `scheduler` 包，预计可以沿用（在 S7 验证）。

## 3. 实测数据

测试方法：在组件外触发场景，然后用 `setTimeout(0)` 反复轮询，记录各判定首次报空闲的时刻，以及那一刻最终 UI 状态是否已经出现在 Fiber 树中（用 S1 的查询读取文本）。

Android debug（每列为毫秒；✓ 表示首次报空闲时最终状态已出现）：

| 场景 | 触发后同步检查 | A 首次空闲 | B 首次空闲 | A&&B | 两次确认 |
|---|---|---|---|---|---|
| basic setState | A 忙，B=0 | 38 ✓ | 38 ✓ | 38 ✓ | 63 ✓ |
| useEffect 链 ×5 | A 忙，B=0 | 42 ✓ | 42 ✓ | 42 ✓ | 66 ✓ |
| startTransition | A 忙，B=0 | 363 ✓ | 404 ✓ | 404 ✓ | 432 ✓ |
| Suspense（300ms promise） | A 忙 | 386 ✓ | 431 ✓ | 431 ✓ | 459 ✓ |
| useDeferredValue | A 忙 | 892 ✓ | 930 ✓ | 930 ✓ | 958 ✓ |
| `<Activity mode="hidden">` | A 忙 | 722 ✓ | 722 ✓ | 722 ✓ | 763 ✓ |

- Android release：所有场景正确，A 与 B 报空闲的时刻一致（prod 没有 profiler 强制进入被动 effect 阶段）。
- iOS debug：只有 Suspense 一次误判（下一节）；其余场景正确。

`<Activity mode="hidden">`：隐藏子树的预渲染以 Idle 优先级执行，A 会一直报忙到预渲染完成；完成后 `pendingLanes` 清零（`endBusy=[]`）⇒ **不会造成永久忙碌**，只是让空闲比可见内容出现得晚一些。

## 4. 为什么必须做两次确认

iOS 上的 Suspense 场景：

```
313ms A=- B=0 text=suspense:fallback   ← 单次检查：误判空闲
330ms A=- B=0 text=suspense:loaded
```

原因：

1. JS 线程被一次长渲染占用（这次是测试代码的 `Slow` 组件，见第 6 节）。
2. 释放后，多个已过期的定时器（resolve promise 的 300ms 定时器和轮询用的定时器）在**同一批**中执行。iOS 上，同一批的定时器回调之间不会清空 microtask。
3. 轮询执行时，promise 的 `.then`（React 的 ping / retry 回调）还没有运行，React 不知道数据已经到了。

对策：判定为空闲后，在**下一个宏任务**里再检查一次。实测所有场景、所有构建的两次确认误判数（`stableIdleButNotFinal`）都是 0。

⇒ Phase 1 的 `waitForIdle` 应该对**所有 tracker** 统一使用这个规则（不只是 React tracker）。这与需求中「画面稳定：连续 N 帧不变」的思路一致。timer tracker 还要注意：定时器回调执行完时，它触发的 microtask 链可能还没跑完。

## 5. 判定 React 空闲**不负责**的事情

- 等待外部数据：Suspense 挂起期间，fallback 已经提交后，React 自身可能是空闲的（iOS 实测 A=-、B=0）。数据来源（网络或定时器）由各自的 tracker 负责。
- 用户代码中的 promise 链（例如 `await` 之后再 setState）：在 setState 被调用之前，React 无从知道。这类情况同样由网络和定时器 tracker 间接覆盖。

## 6. 其他观察

- **测试代码的缺陷**：`S2Lab` 中的 `Slow` 组件没有 memo，任何状态变化都会重新渲染全部 330 个子组件（约 500–680ms 的同步渲染）。这是测试工具的问题，不是 React 或 RN 的问题。但它恰好复现了「JS 线程被长任务阻塞，定时器批量过期」的真实情况，因此保留了这组数据。
- **JS 线程被阻塞时，agent 无法响应**：Host 侧的超时必须按墙上时间计算，并在错误信息中提示「JS 线程可能被长任务占用」。
- **深层 import 弃用警告**：RN 0.88 对 `react-native/Libraries/Renderer/shims/ReactFabric` 发出 `Deep imports from the 'react-native' package are deprecated` 警告。Phase 1 要找替代方案（例如从 hook 的 internals 或 `stateNode.canonical` 获取 public instance），或者在 fiber-adapter 中集中处理这个 import。

## 7. 对 Phase 1 的要求

1. `scheduler-tracker` 和 DevTools hook 必须在渲染器加载之前安装。agent 要检测「已经晚了」的情况（scheduler 已被渲染器读取 ⇒ `scheduledTotal` 一直为 0），并报错。
2. React tracker 的 `describeBusy()` 输出示例：`pendingLanes=0b100000000`、`callbackNode`、`task#35 p3 120ms`。
3. 所有 tracker 统一采用「跨宏任务两次确认」规则。
4. 单元测试：用 fake root 对象和 fake scheduler 测试判定逻辑（不依赖真实 RN）。
