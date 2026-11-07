@REQ-AUTH-001
Feature: 登录
  用户用邮箱登录后进入待办列表。登录请求经过后端（mock server）。

  Scenario: 登录后看到自己的待办列表
    Given 待办列表中有 "写周报" 和 "买牛奶"
    When 用户以 "b@example.com" 登录
    Then 看到 "b@example.com" 的待办列表
    And 列表第一条是 "写周报"

  Scenario: 未输入邮箱时不能登录
    When 用户不输入邮箱直接登录
    Then 看到提示 "请输入邮箱"
