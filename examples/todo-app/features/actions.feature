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

  Scenario: 逐字输入：每个按键都到达 App，防抖只搜索一次
    When 在搜索框里逐字输入 "Item 04"
    Then 搜索框的统计是 "按键 7 次，搜索 1 次：Item 04"

  # Web 的 type 本来就逐键输入（Playwright keyboard.type），只有 native 是一次写入。
  @native
  Scenario: 一次输入整段文本：只有一次按键
    When 在搜索框里一次输入 "Item 04"
    Then 搜索框的统计是 "按键 1 次，搜索 1 次：Item 04"

  Scenario: 滚动到长列表的某一行并点击它
    When 在长列表里找到第 120 行并点击它
    Then 点中了 "第 120 行"

  Scenario: 超时限制的是每一步，不是整个滚动（滚到底要好几步）
    When 在长列表里找到第 200 行并点击它，每步最多等 1500 ms
    Then 点中了 "第 200 行"

  Scenario: 横向列表（嵌在竖列表里）滚动到某一张并点击它
    When 在横向列表里找到第 8 张并点击它
    Then 点中了 "第 8 张"

  @needs-touch
  Scenario: 按距离滚动，内容移动的距离和指定的差不多
    When 把横向列表向右滚动 240
    Then 横向列表移动了大约 240
