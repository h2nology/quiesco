@REQ-DEMO-002
Feature: 值控件与无障碍动作（值控件页）
  滑块、开关、选择器、分段控件、日期，以及读屏软件的无障碍动作。
  （演示 Phase 6.3。native 档位下：开关与分段是真实点击，iOS 的选择器 / 日期滚轮是真实滚动；
  拖动滑块需要真实触摸，js 档位下跳过 @needs-touch。）

  Background:
    Given 打开值控件页

  Scenario: 把滑块设为指定值
    When 把音量设为 35
    Then 音量是 "35"
    And 音量调整结束于 "35"

  @needs-touch
  Scenario: 拖动滑块到指定位置
    When 把音量滑块拖到 75% 的位置
    Then 音量约为 75（误差不超过一档）

  Scenario: 开关
    When 打开通知开关
    Then 通知是 "开"
    And 通知开关已打开
    When 关闭通知开关
    Then 通知是 "关"

  Scenario: 选择器按名称或值选择
    When 在水果选择器中选择 "榴莲"
    Then 选中的水果是 "fruit-3"
    When 在水果选择器中选择 "fruit-8"
    Then 选中的水果是 "fruit-8"

  Scenario: 选择器中没有的项给出可选项
    Then 在水果选择器中选择 "菠萝" 会失败，并列出 "榴莲"

  Scenario: 分段控件
    When 把尺寸设为 "L"
    Then 尺寸是 "L"

  Scenario: 日期
    When 把生日设为 "2027-03-08"
    Then 生日是 "2027-03-08"

  Scenario: 无障碍动作
    When 对数量执行无障碍动作 "increment"
    Then 数量显示 "数量 6"，最近的动作是 "increment"
    When 对数量执行无障碍动作 "reset"
    Then 数量显示 "数量 0"，最近的动作是 "reset"
    When 对数量执行无障碍动作 "activate"
    Then 数量显示 "数量 0"，最近的动作是 "activate"

  Scenario: 未声明的无障碍动作给出已声明的动作
    Then 对数量执行无障碍动作 "archive" 会失败，并列出 "increment"
