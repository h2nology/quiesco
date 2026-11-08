@REQ-PERM-001
Feature: 系统权限预授权
  测试运行前按 quiesco.config 的 permissions 预先授权，场景中不会弹出系统授权对话框。
  iOS 端的 JS 无法查询授权状态（需要权限库），这里只在 Android 与 Web 上检查。

  @android @web
  Scenario: 位置权限已预先授权
    Then App 可以直接使用位置信息
