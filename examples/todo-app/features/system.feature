@REQ-DEMO-006 @native
Feature: 系统集成（系统集成页）
  生物识别（Face ID / 指纹）与摇动。每个场景开始时 Quiesco 会撤销上一个场景的生物识别录入。
  （演示 Phase 6.7。浏览器没有这些设备能力，整个 feature 只在 iOS / Android 上跑。）

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

  Scenario: 摇动设备
    When 摇动设备
    Then 系统集成页显示摇动次数 "1"
