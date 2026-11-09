@REQ-DEMO-003 @needs-touch @multi-touch
Feature: 多指手势（手势页）
  双指捏合、旋转与双指滑动，由 react-native-gesture-handler 识别；iOS 另有 UIScrollView 的原生双指缩放。
  （演示 Phase 6.4。需要真实的多点触摸：js 档位跳过 @needs-touch，Web 的桌面视口没有触摸屏，跳过 @multi-touch。）

  Background:
    Given 打开手势页

  Scenario: 双指放大
    When 在捏合方块上双指放大到 2 倍
    Then 捏合倍数约为 2

  Scenario: 双指缩小
    When 在捏合方块上双指缩小到 0.5 倍
    Then 捏合倍数约为 0.5

  Scenario: 沿斜线方向捏合
    When 在捏合方块上沿 45 度方向双指放大到 1.5 倍
    Then 捏合倍数约为 1.5

  Scenario: 双指旋转
    When 把捏合方块顺时针旋转 90 度
    Then 旋转角度约为 90 度

  Scenario: 双指滑动
    When 在双指区域上双指向上滑动
    Then 双指滑动的方向是 "上"

  @ios
  Scenario: 原生 ScrollView 的双指缩放
    When 在可缩放区域上双指放大到 2 倍
    Then 缩放倍数约为 2
