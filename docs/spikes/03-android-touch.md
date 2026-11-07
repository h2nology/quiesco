# Spike 3：Android 触摸注入

- 日期：2026-11-07
- 环境：Expo SDK 58.0.23 / React Native 0.88.1（Fabric）/ react-native-gesture-handler 3.3.0，Android Emulator API 37，debug（dev client）
- 验证代码：
  - 原生：`spikes/spike-app/modules/spike-touch/android/src/main/java/expo/modules/spiketouch/SpikeTouchModule.kt`
  - JS：`spikes/spike-app/modules/spike-touch/src/SpikeTouchModule.ts`、`spikes/spike-app/spike/s3-run.ts`

## 结论

**可行，只用公开 API。** 在 App 进程内构造 `MotionEvent`，交给 `Activity.dispatchTouchEvent`，就能触发 RN 的完整触摸流程，Pressable 和 RNGH 都能正常响应。

| 验证项 | 结果 |
|---|---|
| Pressable `onPress` | ✅ 0 → 1 |
| Pressable 按下态（`style={({pressed}) => ...}`） | ✅ 按住期间是 pressed 样式；抬起后经过 `minPressDuration` 恢复 |
| 按住期间不触发 onPress，抬起后才触发 | ✅ |
| RNGH `RectButton` `onPress` | ✅ 0 → 1 |
| 连续点击 10 次（只做空闲同步，无固定等待） | ✅ +10，668–1060ms |
| 点击空白区域 | ✅ 不触发任何按钮 |
| 单次点击往返（注入 → React 渲染完毕） | 83–138ms（含按住 50ms） |

## 实现要点

```kotlin
val props = arrayOf(MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER })
val coords = arrayOf(MotionEvent.PointerCoords().apply { x = px; y = py; pressure = 1f; size = 1f })
val ev = MotionEvent.obtain(downTime, eventTime, action, 1, props, coords,
  0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0)
activity.dispatchTouchEvent(ev)   // 返回 true 表示有 View 处理了
ev.recycle()
```

- **线程**：必须在主线程执行。Expo Modules 用 `AsyncFunction(...).runOnQueue(Queues.MAIN)`。
- **Activity**：用 `appContext.currentActivity`。
- **坐标**：JS 侧通过 `getBoundingClientRect()` 取到 dp（S1），原生侧乘以 `displayMetrics.density`（模拟器上是 2.625）换算成 px。窗口是 edge-to-edge，dp 原点和 `dispatchTouchEvent` 的坐标原点一致（实测命中正确）。
- **事件序列**：DOWN 和 UP 使用同一个 `downTime`；UP 用 `Handler.postDelayed` 延迟 `holdMs` 发出，不阻塞主线程。之后的 `longPress`、`swipe` 也可以用同样的方式，在中间插入 MOVE 事件。
- **toolType / source**：设为 `TOOL_TYPE_FINGER` + `SOURCE_TOUCHSCREEN`，RNGH 能正确识别为触摸。
- **API 级别**：只用了 `MotionEvent.obtain`（多指针版本）和 `Activity.dispatchTouchEvent`，都是长期稳定的公开 API。

## 发现：同步必须包括定时器

检查 Pressable 按下态时，第一次的结果是三个时刻都显示 pressed 样式。原因是 Pressability 的 `minPressDuration`（默认 130ms）：抬起之后，它通过 `setTimeout` 延迟把 `pressed` 改回 false，而 spike 中的等待只看 React 是否空闲。

实测：抬起并且 React 空闲时，样式仍然是 pressed；又过了 117ms 才恢复。

⇒ 这直接证明了需求中 **timer tracker** 的必要性：没有它，「抬起后立刻断言样式」这类测试就会变得不稳定。Phase 1 的验收用例中应该包含这个场景。

## 注意事项（Phase 2 实现时）

1. **dev client 的叠加视图**：`Activity.dispatchTouchEvent` 会经过整个窗口的 View 树，dev 菜单或浮动按钮如果显示在顶层，会拦截触摸。e2e 构建要关闭它们（`__expo_disable_onboarding=1&__expo_disable_fab=1`，参见 findings）。
2. **Modal、Dialog**：RN 的 `Modal` 在 Android 上是独立的 `Dialog` 窗口，`Activity.dispatchTouchEvent` 送不到那里。需要找到最上层窗口（例如通过 `WindowManagerGlobal` 的反射，或者在 Modal 的 Dialog 上调用 `dispatchTouchEvent`）。这一项在 spike 中**没有验证**，列为 Phase 2 的风险。
3. **软键盘、系统 UI**：它们不在 App 窗口内，无法注入，也不需要注入。
4. **`dispatchTouchEvent` 的返回值**：返回 true 只表示有 View 处理了事件，不代表点中了目标元素。点中哪个元素，要靠 agent 在注入前做命中检查（坐标处最上层的宿主元素是否就是目标）。
