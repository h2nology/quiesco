# Spike 4：iOS 触摸注入

- 日期：2026-11-07
- 环境：Expo SDK 58.0.23 / React Native 0.88.1（Fabric）/ react-native-gesture-handler 3.3.0，Xcode 27.2，iPhone 17 Simulator / iOS 27.0，debug（dev client，SceneDelegate 启用）
- 验证代码：
  - 原生：`spikes/spike-app/modules/spike-touch/ios/QSTouchInjector.{h,m}`（Objective-C，私有 API）、`SpikeTouchModule.swift`、`SpikeTouch.podspec`（`s.frameworks = 'IOKit'`）
  - JS：`spikes/spike-app/spike/s3-run.ts`（与 Android 共用同一个运行器）

## 结论

**可行。** 在 App 进程内合成 `UITouch` + `UIEvent`（附带 `IOHIDEvent`），交给 `UIApplication.sendEvent:`，RN 的 Pressable 和 RNGH 都能像真实触摸一样响应。**不需要启用替代方案**（需求 §11-3 的情况没有发生）。

| 验证项 | 结果 |
|---|---|
| Pressable `onPress` | ✅ 0 → 1 |
| Pressable 按下态 | ✅ 按住期间是 pressed 样式；抬起后 84ms 恢复（`minPressDuration`） |
| 按住期间不触发 onPress，抬起后才触发 | ✅ |
| RNGH `RectButton` `onPress` | ✅ 0 → 1 |
| 连续点击 10 次（只做空闲同步，无固定等待） | ✅ +10，533ms |
| 点击空白区域 | ✅ 不触发任何按钮 |
| 单次点击往返 | 83ms（含按住 50ms） |
| 截图核对 | ✅ 计数与日志一致 |

## 实现要点

参考 KIF（kif-framework/KIF，Apache-2.0）的做法，独立实现。

1. **窗口**：从 `UIApplication.connectedScenes` 中找出前台激活的 `UIWindowScene`，取它的 `keyWindow`。SDK 58 默认启用 SceneDelegate，不能用已废弃的 `UIApplication.keyWindow`。
2. **命中测试**：`[window hitTest:point withEvent:nil]`。实测命中的是按钮内文字的 `RCTParagraphComponentView`，RN 的触摸系统会把它正确归到 Pressable 上。
3. **UITouch**（私有 setter）：`setWindow:`（必须最先调用，它会重置其他字段）→ `setTapCount:` → `_setLocationInWindow:resetPrevious:` → `setView:` → `setPhase:` → `setGestureView:` → `_setIsFirstTouchForView:` → 每次发送前 `setTimestamp:` 和 `_setHidEvent:`。
4. **IOHIDEvent**（IOKit 私有 C 函数，extern 声明并链接 IOKit）：一个 hand 事件 + 一个 finger 子事件，两者都要设置 `IsDisplayIntegrated` 字段（`(11 << 16) + 25`）。`range` 和 `touch` 在 Ended 时为 0。
5. **UIEvent**：`[UIApplication _touchesEvent]` → `_clearTouches` → `_setHIDEvent:` → `_addTouch:forDelayedDelivery:NO` → `[UIApplication sendEvent:]`。
6. **点击序列**：同一个 UITouch 先以 Began 发送，`holdMs` 之后改成 Ended 再发送一次。
7. **坐标**：iOS 的单位是 pt。JS 侧 `getBoundingClientRect()` 返回的就是窗口坐标，**不需要换算**（Android 则要乘以 density）。
8. **线程**：主线程（`AsyncFunction(...).runOnQueue(.main)`）。

## 风险与约束

1. **私有 API**：用到了 UIKit 的私有方法（`_touchesEvent`、`_addTouch:forDelayedDelivery:`、`_setHIDEvent:`、`_setLocationInWindow:resetPrevious:` 等）和 IOKit 的私有 C 函数。
   - **只能编入 e2e 构建**（需求 §6.3）。由 S6 的 config plugin 条件注入来保证，并在 CI 中检查生产二进制里不含 `QSTouchInjector`、`IOHIDEventCreateDigitizerEvent` 等符号。
   - iOS 每次大版本更新都可能改变这些私有接口。对策：调用前用 `respondsToSelector:` 检查，不满足时明确报错并提示改用 `js` 档位；CI 中至少在最新 iOS 和上一个大版本的模拟器上运行冒烟测试。
2. **只验证了模拟器**：真机不在第一版范围内（需求 §2.2），未验证。
3. **dev client 的浮动按钮**：用 `--initialUrl` 启动时，`__expo_disable_fab` 不起作用，齿轮按钮会显示在右上角。它不在测试按钮附近，这次没有影响点击；Phase 4 需要找到关闭方法（例如通过 `NSUserDefaults`，在 S5 调查）。
4. **未验证**：滑动（Moved 阶段的 `kIOHIDDigitizerEventPosition`）、多指操作、`UIScrollView` 的惯性滚动、RN `Modal`（iOS 上同样是独立的视图控制器，但在同一个窗口中呈现，预计没有问题）。滑动和滚动在 Phase 4 实现 `swipe` / `scroll` 时验证。

## 不采用的替代方案（记录备查）

如果私有 API 将来不可用，可以考虑：

- **借助 XCUITest 进程**：通过 `XCUICoordinate.tap()` 注入，与 Maestro / WebDriverAgent 的做法相同。稳定，但要额外启动一个测试 runner 进程，延迟较高（数百毫秒），而且要另外构建一个 UI 测试 target。
- **`js` 档位**：直接调用 `onPress`，不经过命中测试。

目前没有必要启用它们。
