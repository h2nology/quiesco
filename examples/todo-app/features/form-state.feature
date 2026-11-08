@REQ-TODO-005
Feature: 新建待办表单的状态
  新建页面打开时标题输入框获得焦点；输入标题之前不能标记为重要。
  （演示 Phase 6.1 的状态断言：焦点、可用 / 不可用、开关状态、值、按类型匹配。）

  Background:
    Given 用户 "a@example.com" 已登录
    And 待办列表为空

  Scenario: 打开新建页面时的初始状态
    When 打开新建待办页面
    Then 标题输入框获得焦点
    And 还不能标记为重要
    And 页面上有 1 个开关，并且是关闭的

  Scenario: 输入标题后可以标记为重要
    When 打开新建待办页面
    And 输入标题 "买牛奶"
    And 标记为重要
    Then 标题输入框的内容是 "买牛奶"
    And 已标记为重要
