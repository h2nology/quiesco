@REQ-DEMO-008
Feature: 截图（待办列表）
  当前屏幕、单个元素、整页（列表从头到尾拼成一张长图）、比屏幕还长的元素。带名字的截图保存在本场景的
  产物目录里，并附到报告中。（演示 Phase 6.9。）

  Background:
    Given 用户 "a@example.com" 已登录
    And 待办列表中有 30 条待办
    And 看到 "a@example.com" 的待办列表

  Scenario: 截取当前屏幕
    When 截取当前屏幕，命名为 "屏幕"
    Then 截图和屏幕一样大

  Scenario: 截取一个元素
    When 截取 "add-todo" 的截图，命名为 "新建按钮"
    Then 截图和 "add-todo" 一样大

  Scenario: 整页截图包含整个列表
    When 截取整页截图，命名为 "待办-整页"
    Then 整页截图比屏幕长得多
    And 列表的滚动位置没有变

  Scenario: 截取比屏幕还长的元素
    When 截取完整的 "todo-list"，命名为 "整个列表"
    Then 截图比屏幕上能看到的 "todo-list" 更长
