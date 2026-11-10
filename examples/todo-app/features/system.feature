@REQ-DEMO-006
Feature: 系统集成（系统集成页）
  生物识别（Face ID / 指纹）、摇动与通知。每个场景开始时 Quiesco 会撤销上一个场景的生物识别录入和权限变更。
  （演示 Phase 6.7。浏览器没有这些设备能力，每个场景都只在 iOS / Android 上跑。平台标签取并集，
  所以 @native 写在场景上而不是 feature 上：feature 上的 @native 会让 @android 场景也在 iOS 上跑。）

  Background:
    Given 打开系统集成页

  @native
  Scenario: 录入生物识别
    When 在设备上录入生物识别
    And 读取录入状态
    Then 系统集成页显示录入状态 "已录入"

  # 依赖场景顺序：紧接在「录入生物识别」之后，确认录入在本场景开始前被撤销。
  @native
  Scenario: 上一个场景的录入已撤销
    When 读取录入状态
    Then 系统集成页显示录入状态 "未录入"

  @native
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

  @native
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
