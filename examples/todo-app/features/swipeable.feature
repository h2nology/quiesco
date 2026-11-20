@REQ-DEMO-003 @needs-touch @native
Feature: 可滑动的行（手势页）
  Gesture Handler 的 ReanimatedSwipeable：滑动结束时在 UI runtime 的 worklet 里调用 Gesture Handler 的原生模块
  （issue #74：0.9.0 包装了原生模块，app 在这里崩溃）。

  Scenario: 向左滑动后点删除
    Given 打开手势页
    When 把可滑动的行向左滑动并点删除
    Then 可滑动的行已删除
