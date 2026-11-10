@REQ-DEMO-007
Feature: WebView（帮助页）
  帮助页用 WebView 显示一个网页（iOS / Android：react-native-webview；Web：iframe）。网页里的元素用
  css / xpath / id / 文字查找；点击是屏幕上的真实点击，输入是在获得焦点的输入框里插入文字。
  （演示 Phase 6.8。）

  Background:
    Given 打开帮助页

  Scenario: 在网页里输入名字后打招呼
    When 在网页的名字输入框里输入 "Alice"
    And 点击网页上的 "打招呼"
    Then 网页上的问候是 "你好，Alice"

  Scenario: 替换输入框里的文字
    When 在网页的名字输入框里输入 "Alice"
    And 把网页的名字输入框改成 "Bob"
    And 点击网页上的 "打招呼"
    Then 网页上的问候是 "你好，Bob"

  # 网页先发请求、再等一个定时器才显示结果：断言一直等到它出现。
  Scenario: 等待网页里稍后出现的结果
    When 点击网页上的 "稍后问候"
    Then 网页上的稍后问候是 "晚上好"

  Scenario: 网页底部的元素滚动后可见
    Then 网页上的 "到底了" 不在可见区域
    When 把网页滚动到 "到底了"
    Then 网页上的 "到底了" 可见

  Scenario: 点击网页里的链接
    When 点击网页上的 "常见问题"
    Then 网页的地址以 "#faq" 结尾
    And 网页的标题是 "帮助 #faq"

  Scenario: 在网页里执行脚本
    Then 网页脚本读到的标题是 "帮助"
