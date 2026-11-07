@REQ-TODO-001
Feature: 新建待办
  已登录用户可以新建待办，新建的待办显示在列表最前面。
  排除：待办的编辑与删除不在本文件范围内。

  Background:
    Given 用户 "a@example.com" 已登录

  Scenario: 新建的待办出现在列表最前面
    Given 待办列表为空
    When 新建一条标题为 "买牛奶" 的待办
    Then 列表第一条是 "买牛奶"

  Scenario: 标题为空时不能保存
    When 尝试新建一条标题为空的待办
    Then 看到提示 "请输入标题"
    And 待办列表仍然为空
