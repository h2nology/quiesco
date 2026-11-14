@REQ-DEMO-011
Feature: 返回上一页
  app.goBack() 做用户会做的事（issue #4）：Android 按返回键，Web 浏览器后退，iOS 点导航栏的返回按钮，
  没有返回按钮时从左边缘右滑。步骤里不需要按平台分支。

  Scenario: 从新建待办页返回待办列表
    Given 用户 "a@example.com" 已登录
    When 打开新建待办页面
    And 返回上一页
    Then 看到页面 "todos-screen"

  Scenario: 关闭了返回手势的页面也能返回（iOS 点返回按钮）
    Given 用户 "a@example.com" 已登录
    And 打开能力演示页
    When 返回上一页
    Then 看到页面 "todos-screen"
