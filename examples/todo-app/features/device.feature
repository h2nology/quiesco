@REQ-DEMO-005
Feature: 设备状态（设备状态页）
  屏幕方向、深色模式、字号、语言、定位与运行时权限。每个场景开始时 Quiesco 会把上一个场景改过的设备状态恢复。
  （演示 Phase 6.6。浏览器没有系统字号，字号场景只在 iOS / Android 上跑。）

  Background:
    Given 打开设备状态页

  Scenario: 横屏
    When 把设备转到横屏
    Then 设备状态页显示方向 "landscape"

  # 依赖场景顺序（Cucumber 按文件顺序执行）：紧接在「横屏」之后，确认它在本场景开始前被恢复。
  Scenario: 上一个场景的横屏已恢复
    Then 设备状态页的方向与开始时相同

  Scenario: 深色模式
    When 把设备切换到深色模式
    Then 设备状态页显示外观 "dark"

  @native
  Scenario: 放大字号
    When 把系统字号设为 1.25 倍
    Then 设备状态页显示的字号倍数大于 1.2

  Scenario: 切换语言
    When 把 App 的语言设为 "ja-JP"
    Then 设备状态页显示的语言是日语

  Scenario: 模拟定位
    When 把设备位置设为北纬 35.68、东经 139.76
    And 读取位置
    Then 设备状态页显示位置 "35.68,139.76"

  Scenario: 运行时撤销定位权限
    When 撤销 App 的定位权限
    And 读取位置
    Then 设备状态页显示位置 "无权限"
