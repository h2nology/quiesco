@REQ-DEMO-006 @native
Feature: 系统集成（系统集成页）
  生物识别（Face ID / 指纹）、摇动、通知与系统对话框。每个场景开始时 Quiesco 会撤销上一个场景的生物识别录入和权限变更。
  （演示 Phase 6.7。浏览器没有这些设备能力，feature 默认只在 iOS / Android 上跑；场景上的 @ios / @android / @web
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

  # 认证失败后系统的提示仍在（iOS：「重试 Face ID」弹窗；Android：指纹提示），点它的「取消」按钮
  # （App 之外的系统界面），App 收到用户取消。
  Scenario: 不匹配后取消认证
    Given 设备已录入生物识别
    When 点击生物识别认证
    And 出示不匹配的生物特征
    And 点击系统界面上的 "取消"
    Then 系统集成页显示认证结果 "失败:user_cancel"

  # 系统的权限对话框不属于 App：按按钮找（Android 按 id，iOS 按位置），与设备语言无关。
  # iOS 拒绝一次后不会再询问，所以拒绝和允许各从「尚未决定」开始。
  Scenario: 拒绝通知权限
    Given 通知权限尚未决定
    When 请求通知权限
    And 在系统对话框中拒绝
    Then 系统集成页显示通知权限 "denied"

  Scenario: 允许通知权限
    Given 通知权限尚未决定
    When 请求通知权限
    And 在系统对话框中允许
    Then 系统集成页显示通知权限 "granted"

  # 不经过对话框，直接在系统设置里改（iOS 也可以，issue #113）。
  Scenario: 在系统设置中允许通知
    Given App 可以显示通知
    When 读取通知权限
    Then 系统集成页显示通知权限 "granted"

  Scenario: 在系统设置中关闭通知
    Given 在系统设置中关闭了通知
    When 读取通知权限
    Then 系统集成页显示通知权限 "denied"

  Scenario: 摇动设备
    When 摇动设备
    Then 系统集成页显示摇动次数 "1"

  # iOS：模拟的远程推送，App 的推送库在前台收到。App 要先有通知权限（不依赖前面的场景：并行时场景分到
  # 不同的设备上，Phase 6.12）。
  @ios
  Scenario: App 在前台时收到推送
    Given App 可以显示通知
    When 向 App 发送通知 "早上好"
    Then 系统集成页显示收到的通知 "早上好"

  # 从通知打开 App。iOS：点后台时的横幅（或通知中心里的那条）；Android 模拟器没有推送服务，
  # 通知以 App 的身份发出，从通知栏点开。
  Scenario: 从通知打开 App
    Given App 可以显示通知
    When 把 App 切到后台
    And 向 App 发送通知 "提醒"
    And 从通知栏打开通知 "提醒"
    Then 系统集成页仍然显示

  # 几秒后才发出的本地通知：发出时 App 已在后台，可能是横幅，也可能已进了通知中心里同一 App 的通知堆叠
  # （issues #64、#65、#68）。点中的判断是 App 回到前台。
  Scenario: 从几秒后发出的本地通知打开 App
    Given App 可以显示通知
    When 预约 3 秒后的本地通知
    And 把 App 切到后台
    And 从通知栏打开通知 "稍后提醒"
    Then 系统集成页显示点击的通知 "稍后提醒"

  # 浏览器的 alert / confirm 也是 App 之外的界面：对话框打开期间页面停住，用回答系统界面的同一组 step 回答它。
  @web
  Scenario: 取消网页的确认对话框
    When 点击清零摇动次数
    Then 系统界面显示 "清零摇动次数?"
    When 点击系统界面上的 "Cancel"
    Then 系统集成页显示对话框结果 "取消"
    And 系统界面不再显示 "清零摇动次数?"

  @web
  Scenario: 确定网页的确认对话框
    When 点击清零摇动次数
    And 点击系统界面上的 "OK"
    Then 系统集成页显示对话框结果 "确定"

  @web
  Scenario: 关闭网页的提示
    When 点击显示提示
    Then 系统界面显示 "已保存"
    When 点击系统界面上的 "OK"
    Then 系统集成页显示对话框结果 "提示已关闭"

  # 系统界面也包括其他 App（网页登录）和 App 自己的非 React 界面（issues #49–#51）。
  # Android 模拟器（AOSP 镜像）没有支持 Custom Tabs 的浏览器，网页登录只在 iOS 上跑。
  @ios
  Scenario: 在网页登录页输入并登录
    When 点击网页登录
    And 同意 App 使用网站登录
    And 在系统界面的 "Email" 里输入 "ann@example.com"
    And 点击系统界面上的 "Sign in"
    Then 系统集成页显示网页登录结果 "已登录：ann@example.com"

  @ios
  Scenario: 看到分享面板，用系统点击把它关掉
    When 点击分享
    Then 系统界面显示 "Copy"
    When 在屏幕上 (200, 90) 处做一次系统点击
    Then 系统界面不再显示 "Copy"

  @ios
  Scenario: 在内嵌日历（UIKit）里点一个日期
    When 把内嵌日历滚动到屏幕上
    And 点击系统界面上的 "25"
    Then 内嵌日历选中的日期是 "2026-12-25"

  # Android：ASCII 作为按键输入，其他文字经剪贴板粘贴。
  Scenario Outline: 用系统输入在 App 的对话框里打字（<种类>）
    When 打开输入对话框
    And 在系统界面的 "备注" 里输入 "<文字>"
    And 点击系统界面上的 "完成"
    Then 系统集成页显示输入的内容 "<文字>"

    Examples:
      | 种类  | 文字                 |
      | ASCII | ann@example.com 50%  |
      | 中文  | 你好，世界           |

