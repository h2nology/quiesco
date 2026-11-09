@REQ-DEMO-005
Feature: 设备状态（设备状态页）
  屏幕方向、深色模式、字号、语言、定位、运行时权限、离线、剪贴板与状态栏。每个场景开始时 Quiesco 会把上一个场景改过的设备状态恢复。
  （演示 Phase 6.6。浏览器没有系统字号，字号场景只在 iOS / Android 上跑；iOS 模拟器没有设备级断网，NetInfo 感知不到离线，该场景只在 Android / Web 上跑。）

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

  Scenario: 离线时请求失败
    When 把设备切换到离线
    And 发送请求
    Then 设备状态页显示请求结果 "失败"

  # 依赖场景顺序：紧接在「离线时请求失败」之后，确认离线在本场景开始前被恢复。
  Scenario: 上一个场景的离线已恢复
    When 发送请求
    Then 设备状态页显示请求结果 "成功"

  @android @web
  Scenario: App 感知到离线与恢复
    When 把设备切换到离线
    Then 设备状态页显示网络 "offline"
    When 把设备切换到在线
    Then 设备状态页显示网络 "online"
    When 发送请求
    Then 设备状态页显示请求结果 "成功"

  Scenario: App 读到测试写入的剪贴板
    When 把剪贴板设为 "Quiesco 剪贴板"
    And 读取剪贴板
    Then 设备状态页显示剪贴板 "Quiesco 剪贴板"

  Scenario: 测试读到 App 复制的文字
    When 在 App 里点击复制
    Then 剪贴板内容是 "来自 App 的文字"

  Scenario: 截图用的状态栏
    When 把状态栏设为 9:41、满电、信号满格
    Then 截图附到报告
