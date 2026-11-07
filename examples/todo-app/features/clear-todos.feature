@REQ-TODO-002
Feature: 清空待办
  已登录用户可以一次清空全部待办，清空前需要在弹窗中确认。

  Background:
    Given 用户 "a@example.com" 已登录
    And 待办列表中有 "写周报" 和 "买牛奶"

  Scenario: 确认后清空全部待办
    When 清空全部待办并确认
    Then 待办列表仍然为空

  Scenario: 取消后待办保留
    When 清空全部待办但取消
    Then 列表中有 2 条待办
