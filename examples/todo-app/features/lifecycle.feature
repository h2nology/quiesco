@REQ-DEMO-004
Feature: 应用生命周期（生命周期页）
  带参数 / 深链接重启、保留或清除数据、后台与前台、结束 App、运行时调整同步、元素截图。
  （演示 Phase 6.5。Web 的页面无法真正进入后台，后台场景只在 iOS / Android 上跑。）

  Scenario: 以启动参数和深链接重新启动
    When 以启动参数 '{"user":"ann","retries":3,"beta":true}' 重新启动 App 并打开生命周期页
    Then 页面显示的启动参数是 '{"user":"ann","retries":3,"beta":true}'

  Scenario: 重新启动后数据还在
    Given 打开生命周期页
    When 点击访问 +1 共 2 次
    And 重新启动 App 并打开生命周期页
    Then 访问计数是 "2"
    And 页面显示的启动参数是 '{}'

  Scenario: 清除数据后重新启动
    Given 打开生命周期页
    When 点击访问 +1 共 2 次
    And 清除数据后重新启动 App 并打开生命周期页
    Then 访问计数是 "0"

  @native
  Scenario: 切到后台再回到前台
    Given 打开生命周期页
    When 把 App 切到后台
    Then 操作页面会失败，原因是 "APP_IN_BACKGROUND"
    When 把 App 切回前台
    Then App 状态记录经过了 "background"，现在是 "active"
    When 点击访问 +1 共 1 次
    Then 访问计数是 "1"

  Scenario: 结束 App 之后的操作给出明确的错误
    Given 打开生命周期页
    When 结束 App
    Then 操作页面会失败，原因是 "APP_NOT_RUNNING"

  Scenario: 运行时只关闭定时器同步，并忽略轮询计数
    Given 打开生命周期页
    When 关闭定时器同步，并忽略轮询计数的变化
    And 开始轮询
    And 点击访问 +1 共 1 次
    Then 访问计数是 "1"
    And 轮询仍在进行
    When 停止轮询

  Scenario: 元素截图
    Given 打开生命周期页
    When 截取红色方块的截图
    Then 截图的宽高比是 80:50，中心是红色
