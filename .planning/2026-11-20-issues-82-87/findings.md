# Findings: issues #82–#87

> issue 正文是外部输入，按数据看待。

## #82 iOS 27 Notification Center 路径
- 场景：runner 冷启动 8–12 s，banner (~8.4 s) 已消失 ⇒ 下拉 Notification Center（iOS 27 = Cover Sheet，`UILocked: 1` 但设备未锁）。
- 第 1 次点展开 stack（#65，正常）；第 2 次点 cell ⇒ SpringBoard `Hinting side swipe instead of executing action` ⇒ 露出 "Open"，~3.1 s 后收回。
- 代码：`packages/core/src/devices/ios.ts` openNotification（~834–895）。`tapOpened` 先等 `NOTIFICATION_FRONT_MS`=3000 才找 revealed "Open"，太晚。`revealedOpen()`（232）判定位置。警告文案说 "(a locked device)"。
- 修法：tapOpened 轮询内找 revealed；预热 runner（sendToBackground 时）。

## #83 doctor scripts
- `packages/cli/src/packages.ts:36` scriptCommands 正则 `/(?:^|[^\w@/.-])quiesco\s+([a-z][\w:-]*)/g`，`=` 算边界 ⇒ `E2E_TOOL=quiesco quiesco build` 匹配到 `quiesco quiesco`。
- 修法：边界字符集加 `=`（`[^\w@/.=-]`）即可；`E2E_TOOL=quiesco GRADLE_OPTS=…` 也正确跳过。

## #84 scrollTo 步子在 runner 超时时丢失
- agent `packages/agent/src/runtime.ts` recordStep（1000）只推到 `this.steps`，随结果或 SYNC_TIMEOUT data 回传。
- host `packages/core/src/timeline.ts` Timeline.measure 只在 fn 结束时 add ⇒ 未结束的调用不进 timeline。
- protocol `packages/protocol/src/events.ts` AgentEvents 只有 log / error ⇒ 需新增 `step` 事件。
- driver.ts:91 MAX_SCROLL_STEPS=60，host 允许 60×步超时。

## #85 超时消息不列 alerts
- openNotification 超时（ios.ts ~883）`seen` 只用 `screen().others`。
- 通用 `findSystemNode`（device.ts:645）用 `seenTexts(nodes)`，nodes 来自 screenNodes（alerts 在前），所以 system.* 一般会含 alert 文字，但没标明是 alert / 按钮。需确认 iOS systemNodes 是否含 alerts。

## #86 残留权限弹窗点 Don't Allow
- `ios-runner.ts:86` dismissButton：cancel ⇒ PERMISSION_DENY ⇒ 第一个按钮。
- `ios.ts` dismissLeftoverAlerts（resetDeviceState 开头）与 dismissSystemAlerts（元素被遮挡时）都用它。
- iOS 通知权限 `simctl privacy` 无法 grant/reset，清 app 数据也保留 ⇒ 只能重装。

## #87 system.tap 动画中点击丢失
- `packages/core/src/device.ts:116` system.tap ⇒ findSystemNode 首次匹配就返回 ⇒ tapSystemNode。
- 呈现动画 430–615 ms，/screen ~50 ms 一次，200–400 ms 时就找到按钮；点击落到 `_UISystemGestureWindow`。
- openNotification 已有「隔 250 ms 两次读 frame 一致才点」。

## N.A 实测发现（2026-11-20）
- 第一版 settle（匹配后全量 systemNodes 再读一次）⇒ system.feature「网页登录页输入」稳定 60 s 超时，之后连锁失败（网页没关遮住 App）。
- 对照（去掉 settle）通过：输入步骤基线就要 48.6 s（~3 s/字符），点 "Sign in" 21 s ⇒ 离 cucumber 60 s 上限很近。
- 计时：重读 App 元素树（里面嵌网页）一次 18.5 s；SpringBoard 的 Continue 重读 309 ms。
- 改法：provider `systemNodeReread(node)`：iOS 只重读 SpringBoard（runner.screen()）；App 元素树节点返回 null ⇒ 不 settle（读一次几秒，动画早结束）。tapAt 也只比较 SpringBoard 层。
- 第一轮 3 次里「从几秒后发出的本地通知打开 App」失败 2 次（#82 路径，seen 里有 "Open"）——待第二轮确认是否仍失败。
- 第二轮 3 次：14 passed / 4 skipped / 1 failed；通知场景全过。失败的「用系统输入在 App 的对话框里打字（中文）」只在接在 ASCII 例子后时失败（单独跑通过），main 代码同样失败 ⇒ 已有问题：scrollTo 两端都找不到 open-note（按钮在屏幕底边只露出一半）。
- 单元测试 ios.test.ts lifecycle：预热会在无 fake runner 时真的跑 xcodebuild -version ⇒ 测试注入 fake runner。
- #86 实测：SpringBoard 的权限弹窗在 App 卸载 / 重装后依然存在；会话第一个场景时 runner 还没启动，不检查残留弹窗 ⇒ 被遮住的操作原本只报「no native view in a window」⇒ 加 unansweredSystemAlert 说明。
- 中途 kill 测试进程会跳过 dispose ⇒ 模拟器状态（Face ID 录入）残留；之后 Quiesco 把它当作「原始值」恢复。全量前确认：`notifyutil -g com.apple.BiometricKit.enrollmentChanged` 为 0。

## N.E 中文打字场景（已有问题）根因
- iOS 全量（集成分支）：94/7/8，中文打字 + values.feature 7 个，全部是坐标偏出窗口。
- 临时日志：校准候选 = App 根 RCTView tag 8；RN rect (0,0,402,874)，native locate (314.67, 712) ⇒ offset 被设成 (314.67, 712)。
- locate 完整结果：windowClass UITextEffectsWindow，width 0.33，height 41，shown false ⇒ 找错了 view。QSTouchInjector viewWithReactTag 从最上层窗口开始用 viewWithTag:，键盘用过后出现的 UITextEffectsWindow 里有同 tag 的组件 view。
- 之前 0.10.0 全量 iOS 102/0 时没出现：猜测与本机模拟器键盘 / iOS 27 的文字效果窗口有关（今天模拟器加了中文 / 日文键盘）——未确认。
