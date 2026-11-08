@REQ-DEMO-001
Feature: 动作（能力演示页）
  点击指定位置、连击、键盘按键、替换文本、拖拽、长列表滚动。
  （演示 Phase 6.2 的动作；拖拽需要真实触摸，js 档位下跳过 @needs-touch。）

  Background:
    Given 打开能力演示页

  Scenario: 点击区域内的指定位置
    When 点击画布的 "右下角"
    Then 点中了 "右下"
    When 点击画布的 "左上角"
    Then 点中了 "左上"

  Scenario: 连续点击与按屏幕坐标点击
    When 连续点击计数按钮 3 次
    Then 计数是 "3"
    When 按屏幕坐标点击计数按钮所在的位置
    Then 计数是 "4"

  Scenario: 键盘按键与替换文本
    When 在备注框输入 "abc"
    And 在备注框按 "backspace"
    Then 备注框的内容是 "ab"
    When 在备注框按 "enter"
    Then 已提交 "ab"
    When 把备注替换为 "hello"
    Then 备注框的内容是 "hello"

  @needs-touch
  Scenario: 拖拽方块放进区域
    When 把方块拖到 "drop-b"
    Then 看到拖拽结果 "放在 B 区"
    When 把方块拖到 "drop-a"
    Then 看到拖拽结果 "放在 A 区"

  Scenario: 长列表滚动到指定行和两端
    When 把长列表滚动到第 150 行
    Then 第 150 行可见
    When 把长列表滚动到 "bottom"
    Then 第 200 行可见
    When 把长列表滚动到 "top"
    Then 第 1 行可见
