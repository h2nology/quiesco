Feature: 通用步骤（中文）
  用 @quiesco/steps 的中文步骤直接驱动示例 App。

  Scenario: 值控件与状态断言
    Given 通过后门 "openControls" 打开页面 "controls"
    When 把滑块 "volume" 设为 35
    Then 元素 "volume-value" 的文本是 "35"
    When 打开开关 "notify"
    Then 元素 "notify" 已选中
    When 关闭开关 "notify"
    Then 元素 "notify" 未选中
    When 在 "fruit" 中选择 "榴莲"
    Then 元素 "fruit-value" 的文本是 "fruit-3"

  Scenario: 登录并用回车新建待办
    When 在 "email" 中输入 "zh@example.com"
    And 在 "password" 中输入 "secret"
    And 点击 "login-button"
    Then 元素 "greeting" 的文本是 "zh@example.com"
    When 点击 "add-todo"
    And 在 "todo-title" 中输入 "买牛奶"
    And 在 "todo-title" 中按回车
    Then 元素 "todo-item" 共有 1 个

  Scenario: 外观与屏幕方向
    Given 通过后门 "openDevice" 打开页面 "device"
    When 把外观设为深色模式
    Then 元素 "color-scheme" 的文本是 "dark"
    When 把设备转到横屏
    Then 元素 "orientation" 的文本是 "landscape"
