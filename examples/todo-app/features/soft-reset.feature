@REQ-DEMO-010
Feature: 软重置回到初始页面
  上一个场景停在推入的页面上，下一个场景仍从初始页面（登录页）开始。软重置把 Expo Router 的导航状态
  恢复到 App 启动时的状态，并检查路由（issue #1）。本 App 的根 layout 在恢复会话前不渲染 Stack，
  软重置时 Stack 本来就会重建，所以这里是回归检查；issue 里的布局（QuiescoRoot 下直接放 Stack）
  在发布前的冒烟 App 上验证。

  Scenario: 场景停在推入的页面上结束
    Given 打开能力一览
    When 在能力一览点 "playground"
    Then 看到页面 "playground"

  Scenario: 下一个场景从登录页开始
    Then 看到页面 "login-screen"
