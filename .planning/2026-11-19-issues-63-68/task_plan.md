# Task Plan: 处理 GitHub issues #63–#68（0.8.1 之后）

## Goal
解决 h2nology/quiesco 的 6 个 open issue（同一位用户在 0.8.0 + Vitest 5.1 + Expo SDK 58 Release 构建、iOS 27 模拟器 / Android API 36 模拟器上的实测反馈）。每个修复都配单元测试，必要时更新三语文档；实跑验收后回复并关闭 issue，最后一起发版。

## Current Phase
M.C Android 后台 idle 等待（#66）

## Next Step
从 fix/ios-open-notification 开分支 `fix/background-idle-wait`；M.C.0：example 的 device 页加「请求位置权限」按钮 + 场景，Android 上复现 #66，记录挂住时忙的 tracker。

## 背景
- 前置：0.8.1 已发布（`dc7ca7d chore(release): 0.8.1`）。上一轮计划：`.planning/2026-11-19-issues-44-55/`。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md` 的「工作约定」：先出计划再写代码；测试和 step 里禁止 sleep；宣称完成前要实跑验收；待确认事项问 HU；平台分支只在 fiber-adapter / 存储适配器 / DeviceProvider；用户的个人信息不写进包，也不发给外部服务。
- issue 摘要和代码定位见 findings.md。

## Issue 一览与分组

| # | 类型 | 标题（简） | 阶段 | 难度 |
|---|------|-----------|------|------|
| 63 | bug | scrollTo 所有步共用一个 10 s 期限，超时后却报「两端都滚到了」 | M.A | 小 |
| 64 | bug | iOS openNotification 的超时包含 XCUITest runner 启动时间 | M.B | 小 |
| 65 | bug | iOS openNotification 点到通知堆叠时 runner 崩溃（stale index）；ECONNRESET 不重试 | M.B | 中 |
| 68 | bug | iOS openNotification 把横幅自己消失当作点中；app 一直挂起 | M.B | 中 |
| 66 | bug | Android 动作打开系统对话框后，idle 等待可能永远挂住（后台 JS timer 暂停） | M.C | 中（要先复现确认哪个 tracker 忙） |
| 67 | question | 原生模块的 pending promise 不算忙 | M.D | 中–大（要调研） |

分组依据：#64/#65/#68 是同一个场景（定时通知 → 后台 → openNotification）在 0.8.0 的三种失败方式，0.7.0 是 5/5 通过，一起改、一起验收；#63 是 agent 侧独立的小改动；#66 是 sync 引擎；#67 先调研再定范围。

## 待决定事项（2026-11-19：D1、D2、D4、D5、D6 由 HU 选了推荐项；D3 按推荐默认执行）
| ID | 问题 | 推荐 |
|----|------|------|
| D1 | #63 scrollTo 怎么改 | 改为多步动作：每一步（拖动 + 等 idle）各自用完整 timeout，总步数上限 `MAX_SCROLL_STEPS`（60，与 scrollToEdge 一致，两个方向合计）。到上限 / 期限结束时报 `ELEMENT_NOT_FOUND`，消息写明「N 步后在 offset Y 停止，未到两端」；只有真的两端都到了才说 both ends。 |
| D2 | #64/#65/#68 openNotification 的整体方案 | ① 先 `runner.start()` 再记 `start`/`deadline`（其他 `system.*` 首次调用同样处理）；② Swift `/screen` 改为一次 `snapshot()` 构建结果，元素消失不再让 server 结束；③ `call()` 把 `ECONNRESET` / socket hang up 也当 runner 挂了：重启后重试一次，再失败报 `DEVICE_ERROR` 带 runner 输出；④ 点中的判断改为「app 到了前台」（runner `/elements?bundleId=` 的 `state == 4`，即 runningForeground），而不是「通知不见了」；没到前台就打开通知中心再找、再点，直到超时；⑤ 堆叠：点之后如果出现了展开（同 title 的多个 platter / "Show less"），点最上面那个匹配的 platter。`BANNER_WAIT_MS` 保持 2 s 不变（有了 ④⑤ 不需要退回 0.7.0 的长等待）。 |
| D3 | #68 的附带要求：上一个测试遗留挂起的 app 不应在下一个测试 reset 时报「不响应」 | reset 前若 provider 报告 app 在后台 / 挂起，先把它切到前台（iOS `simctl launch` 已运行的 app 会带到前台），再发 reset。做在 M.B 里。 |
| D4 | #66 后台 idle 等待怎么改 | 先复现确认是哪个 tracker 在背景时还忙。方案：在后台时不靠 JS timer 唤醒——tracker 状态变化（network 结束、React commit、idle-callback 执行）时主动 wake 等待循环；另外动作开始后 app 进入后台 ⇒ 动作后的等待只等一次 wake 或所有可结算 tracker idle，最多等到期限（期限检查也在每次 wake 时做）。若 `@quiesco/native` 可用，用它的原生定时器做兜底超时，保证至少能报 `SYNC_TIMEOUT`。 |
| D5 | #67 原生模块 promise | 分两步：先在文档（sync.mdx 三语）写明「handler 在两个被追踪的步骤之间 await 原生调用时，中间会被判为 idle」以及写法建议（之后 `expectVisible` 下一屏）；再做 M.D.0 调研：能否在 New Architecture 下包装 `TurboModuleRegistry.get/getEnforcing` 返回的模块，追踪返回 promise 的方法（需忽略列表，防止长期 pending 的 promise 永远忙）。可行 ⇒ 作为 `sync.trackNativeModules`（默认关）加入；不可行 ⇒ 只改文档并在 issue 里说明。 |
| D6 | 版本号 | 只有 bug 修复 + 文档 ⇒ 0.8.2；若 D5 加了新配置 ⇒ 0.9.0。所有阶段完成、验收后一起发。 |

## Phases

### M.0 调研与计划
- [x] 读 6 个 issue，写 findings
- [x] 初步代码定位（见 findings.md）
- [x] HU 确认 D1–D6
- **Status:** complete

### M.A scrollTo 多步化（#63）
分支 `fix/scroll-to-steps`。
- [x] `runtime.ts`：`scrollTo` 加入 `multiStep`；每步（拖动 + 等 idle，含程序化补滚）用 `stepDeadline = now + timeoutMs`，performer 按步创建（`performerFor(deadline)`）；两方向合计上限 `MAX_SCROLL_TO_STEPS = 60`；开头找容器仍用整体 deadline
- [x] `driver.ts`：host 侧 `steps` 对 `scrollTo` 也用 `MAX_SCROLL_STEPS`（60）
- [x] 错误消息：步数用完 ⇒ `Gave up scrolling … after N steps at offset {x,y} (no end reached | reached the bottom end) … Use scrollToIndex for a long list.`；真到两端 ⇒ `to both ends (N steps)`；读不到 offset ⇒ 单独说明
- [x] 三语 api.mdx：多步动作列表加 scrollTo（最多 60 步）；`pnpm plugin:refs` 重新生成
- [x] 单元测试 3 个（runtime.test.ts，旧代码 3 个都失败）：每步各自 timeout（19 步 × 80 ms，timeout 300 ms）；60 步上限的消息；真到两端的消息
- [x] example：actions.feature 新场景「超时限制的是每一步」（第 200 行，每步 1500 ms）+ step
- [x] 实测：iOS 3/3、Android 3/3（长列表相关场景）；旧 runtime 下新场景在 iOS 失败（SYNC_TIMEOUT，和 issue 一致）；web actions.feature 10 passed / 1 skipped（@native，本来就跳过）
- [x] `pnpm check`（951 tests）+ `pnpm docs:check` 通过
- [x] 提交、开 PR（HU 2026-11-19：之后每个阶段验证完就自动提交 + 开 PR，不用再问）
- **Status:** complete

### M.B iOS openNotification（#64、#65、#68）
分支 `fix/ios-open-notification`（从 fix/scroll-to-steps 开，堆叠在 PR #69 上）。
- [x] #64：provider 接口加 `prepareSystemUi?()`（iOS：`runner.start()`）；`findSystemNode` / `expectNotVisible` / iOS `openNotification` / `openUrlFromOutside` 在记时前调用
- [x] #65 Swift：`screen()` 改为 `springboard.snapshot()` 遍历（alerts 也是）；可点判断改为 frame 在屏幕内（snapshot 没有 isHittable）。实测：app 在前台时 others 为空，通知中心打开时列出 cell / platter
- [x] #65 TS：`isRunnerGone`（ECONNREFUSED / ECONNRESET / EPIPE / UND_ERR_SOCKET / socket hang up）；只读请求（screen / elements / navigationBar / appState）重启后重发一次；tap 等 POST 遇 reset ⇒ 重启 runner 后报 `DEVICE_ERROR`（不重复点击）；两次都失败 ⇒ `DEVICE_ERROR` 带输出
- [x] #68：新端点 `GET /appState?bundleId=`；点中的判断 = app 在前台（3 s 内，且不超过期限）；没到前台 ⇒ 再找（横幅没了就打开通知中心）再点，最多 3 次；超时消息区分「没找到」和「点了 N 次但没到前台」
- [x] #65 堆叠：匹配项里取最上面的（y 最小）
- [x] 实测发现：锁屏状态下点通知只会把它滑开、露出「Open」（随设备语言）⇒ 点完没到前台时，找同一行**左侧**新出现的、比半行窄的、不是通知（label 不含 ", "）的按钮并点它（第一版太宽，iOS 全量里误点了别的 app 的通知）
- [x] 点击后匹配项变多（堆叠展开）⇒ 立刻重新查找，不等满 3 s
- [x] 两次读取位置之间隔一个轮询间隔（通知中心下拉动画中途的点击会失效）
- [x] D3：`DeviceApi.openNotification` 等前台失败时把 appState 恢复为 `background` ⇒ 下一个场景 reset 走 bringToForeground，不再等挂起的 app 15 s
- [x] 三语 api.mdx 的 openNotification 说明；plugin refs
- [x] 单元测试：runner reset 重试 / 不重复 tap / 两次失败；runner 启动慢不计入超时；横幅自行消失 ⇒ 去通知中心；堆叠点最上面；锁屏点 Open；一直没到前台的消息；D3（device-state）
- [x] example：system 页加「3 秒后提醒」按钮（expo-notifications 本地通知）+ 场景「从几秒后发出的本地通知打开 App」+ 两个 step
- [x] 实测 iOS：改锁屏处理前 5 次中 1 次失败（锁屏 Open）；改后通知两个场景连续 6/6
- [x] iOS 全量第 1 次：107 场景 96 passed / 4 failed（新通知场景误点别的 app 的通知 ⇒ 连锁；分享面板 / 日历 / 生物识别单独跑 5/5、3/3 通过）⇒ 修正后通知场景 6/6；system.feature 两次 15/15（第 2 次实际走到锁屏 Open 路径并通过）；Android system.feature 12 passed / 7 skipped
- [x] `pnpm check`（960）+ docs:check
- [x] 提交、PR（base fix/scroll-to-steps）
- **Status:** complete

### M.C Android 后台 idle 等待（#66）
分支 `fix/background-idle-wait`。
- [ ] M.C.0 复现：example app 的 `request-location` + 权限对话框，记录挂住时哪个 tracker 忙（加 debug 日志）
- [ ] 按 D4 改 `wait-for-idle.ts`：tracker 变化事件唤醒；期限检查在每次唤醒时做；后台时的兜底超时
- [ ] tracker 接口加可选 `onChange(cb)`；network / react / idle-callback 实现
- [ ] 单元测试：假时钟下「后台 + tracker 忙 + timer 不触发」⇒ tracker 变 idle 时返回；无事件时兜底超时报 SYNC_TIMEOUT
- [ ] 实测：Android 每次重启模拟器跑 10 次该场景，全部通过；下一个测试的 reset 不再挂
- **Status:** pending

### M.D 原生模块 promise（#67）
- [ ] 文档：sync.mdx（en/ja/zh）tracker 表后加说明和推荐写法
- [ ] M.D.0 调研：RN 0.88 New Architecture 下 `TurboModuleRegistry` 的包装点、Expo modules（`requireNativeModule`）的包装点、AsyncStorage 走哪条路
- [ ] 按调研结果和 D5 决定是否实现 `sync.trackNativeModules`
- **Status:** pending

### M.E 验收、回复、发版
- [ ] 全量单元测试 + lint + typecheck + dependency-cruiser
- [ ] example app 三端（iOS / Android / web）全量 e2e
- [ ] 逐个回复 #63–#68（说明原因、修复、版本），关闭
- [ ] 按 docs/releasing.md 发版（D6）
- **Status:** pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| #64/#65/#68 一起改，BANNER_WAIT_MS 保持 2 s | 点中判定改为 app 前台 + 堆叠处理后，不需要退回 0.7.0 的长等待（HU 2026-11-19） |
| scrollTo 步数上限 60 与 scrollToEdge 一致，不扣除找容器和最后 settle | host 侧 MAX_SCROLL_STEPS 也是 60，scrollToEdge 一直如此；每步很少用满 timeout |
| #66 事件唤醒 + 原生定时器兜底 | 不依赖后台暂停的 JS timer，且至少能报 SYNC_TIMEOUT（HU 2026-11-19） |
| #67 先文档再调研，实现则默认关 | 长期 pending 的原生 promise 有让 app 永远忙的风险（HU 2026-11-19） |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| iOS 新通知场景 1/5 失败：点了 2 次，app 没到前台，通知中心里该通知被滑开、露出「Open」 | 1 | 锁屏时点通知只会露出 Open ⇒ 点完后找同一行新出现的按钮并点；两次读取之间等 250 ms。之后 6/6 |
| iOS 全量：锁屏 Open 判断太宽，把展开后移进同一行的别的 app 的通知当成 Open 点了 | 1 | 只认左侧、窄于半行、非通知的新按钮；单元测试覆盖 |
| 想用 Cmd+L 锁住模拟器验证锁屏路径：Simulator.app 没开（headless），osascript 失败 | 1 | 不打开用户的 Simulator 窗口；锁屏路径只有单元测试覆盖 |
