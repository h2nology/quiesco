@REQ-DEMO-009
Feature: 能力一览
  从一个入口进入每个隐藏的测试页面，以及长按后拖动的列表排序。
  （演示 Phase 6.11。各页面的能力在各自的 feature 里测；拖拽需要真实触摸，js 档位下跳过 needs-touch。）

  Scenario Outline: 从能力一览进入「<页面>」
    Given 打开能力一览
    When 在能力一览点 "<入口>"
    Then 看到页面 "<页面根>"

    Examples:
      | 页面     | 入口       | 页面根       |
      | 动作     | playground | playground   |
      | 拖拽排序 | reorder    | reorder      |
      | 值控件   | controls   | controls     |
      | 多指手势 | gestures   | gestures     |
      | 生命周期 | lifecycle  | lifecycle    |
      | 设备状态 | device     | device       |
      | 系统集成 | system     | system       |
      | WebView  | webview    | webview-page |

  @needs-touch
  Scenario: 长按后拖动列表行排序
    Given 打开拖拽排序页
    When 把第 1 行拖到第 3 行的位置
    Then 列表顺序是 "香蕉、樱桃、苹果、葡萄、橘子"
    When 把第 5 行拖到第 2 行的位置
    Then 列表顺序是 "橘子、香蕉、樱桃、苹果、葡萄"

  @needs-touch
  Scenario: 没有长按就滑动不会拿起列表行
    Given 打开拖拽排序页
    When 在第 1 行上快速向下滑动
    Then 列表顺序是 "苹果、香蕉、樱桃、葡萄、橘子"
