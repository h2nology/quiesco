@REQ-DEMO-006 @native
Feature: 系统集成（系统集成页）
  生物识别（Face ID / 指纹）、摇动、通知与系统对话框。每个场景开始时 Quiesco 会撤销上一个场景的生物识别录入和权限变更。
  （演示 Phase 6.7。浏览器没有这些设备能力，整个 feature 只在 iOS / Android 上跑；场景上的 @ios / @android
  比 feature 上的 @native 更靠内，以场景为准。）

  Background:
    Given 打开系统集成页

  Scenario: 录入生物识别
    When 在设备上录入生物识别
    And 读取录入状态
    Then 系统集成页显示录入状态 "已录入"

  # 依赖场景顺序：紧接在「录入生物识别」之后，确认录入在本场景开始前被撤销。
  Scenario: 上一个场景的录入已撤销
    When 读取录入状态
    Then 系统集成页显示录入状态 "未录入"

  Scenario: 生物识别认证成功
    Given 设备已录入生物识别
    When 点击生物识别认证
    And 出示匹配的生物特征
    Then 系统集成页显示认证结果 "成功"

  # 不匹配时系统保留重试提示（与真机一致）。iOS 的重试弹窗要点按钮才能继续（系统弹窗，Phase 6.7 批次 C）；
  # Android 的指纹提示仍在等待，换成匹配的手指即可通过。
  @android
  Scenario: 不匹配后再出示匹配的指纹
    Given 设备已录入生物识别
    When 点击生物识别认证
    And 出示不匹配的生物特征
    Then 系统集成页显示认证结果 "…"
    When 出示匹配的生物特征
    Then 系统集成页显示认证结果 "成功"

  # 认证失败后系统的指纹提示仍在，点它的「取消」按钮（App 之外的系统界面），App 收到用户取消。
  @android
  Scenario: 不匹配后取消认证
    Given 设备已录入生物识别
    When 点击生物识别认证
    And 出示不匹配的生物特征
    And 点击系统界面上的 "取消"
    Then 系统集成页显示认证结果 "失败:user_cancel"

  # 系统的权限对话框不属于 App：按按钮的 id 找，与设备语言无关。
  @android
  Scenario: 先拒绝再允许通知权限
    Given 通知权限尚未决定
    When 请求通知权限
    And 在系统对话框中拒绝
    Then 系统集成页显示通知权限 "denied"
    When 请求通知权限
    And 在系统对话框中允许
    Then 系统集成页显示通知权限 "granted"

  Scenario: 摇动设备
    When 摇动设备
    Then 系统集成页显示摇动次数 "1"

  # iOS：模拟的远程推送，App 的推送库在前台收到。
  @ios
  Scenario: App 在前台时收到推送
    When 向 App 发送通知 "早上好"
    Then 系统集成页显示收到的通知 "早上好"

  # Android 模拟器没有推送服务：通知以 App 的身份发出，从通知栏点开后回到 App。
  @android
  Scenario: 从通知栏打开通知回到 App
    Given App 可以显示通知
    When 把 App 切到后台
    And 向 App 发送通知 "提醒"
    And 从通知栏打开通知 "提醒"
    Then 系统集成页仍然显示
