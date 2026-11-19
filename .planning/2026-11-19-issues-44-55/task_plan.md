# Task Plan: 处理 GitHub issues #44–#55（0.7.0 之后）

## Goal
解决 h2nology/quiesco 的 12 个 open issue（同一位用户在 0.7.0 + Vitest + Expo SDK 58 Release 构建、iOS 27 模拟器 / Android API 36 模拟器上实测的反馈）。每个修复都配测试和三语文档，实跑验收后回复并关闭 issue，最后一起发下一个版本。

## Current Phase
L.E system UI 与原生控件（#49、#50、#51）

## Next Step
HU 确认 L.E 的提交 / PR（滚动回归的修复作为单独的 commit）；之后进入 L.F（发布 0.8.0）。

## 背景
- 前置：0.7.0 已发布（`707bade chore(release): 0.7.0`）。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md` 的「工作约定」：先出计划再写代码；测试和 step 里禁止 sleep；宣称完成前要实跑验收；待确认事项问 HU；平台分支只在 fiber-adapter / 存储适配器 / DeviceProvider；用户的个人信息不写进包，也不发给外部服务。
- issue 摘要和代码定位见 findings.md。

## Issue 一览与分组

| # | 类型 | 标题（简） | 阶段 | 难度 |
|---|------|-----------|------|------|
| 47 | bug | Android openNotification 只等 5 s，不看 timeoutMs | L.A | 小 |
| 55 | bug | `quiesco list` 把 `test.beforeEach` 当测试；共享模块里的 hook 只对第一个文件生效 | L.A | 小 |
| 44 | bug | Android 带 refreshControl 的列表 scrollTo 只拖一次就放弃 | L.A | 小 |
| 45 | bug | scrollTo 只露出 1 pt 就停；tap 打到整个 rect 中心；hitTest 不看裁剪 | L.B | 中 |
| 46 | bug | 竖列表里嵌的横列表 scrollTo 失败；scroll 的 distance 无效 | L.B | 中（要先在 iOS 上查原因） |
| 48 | enh | 后台时不能 openUrl（deep link 热启动） | L.C | 中 |
| 53 | enh | iOS setLocale 要求 CFBundleLocalizations | L.C | 小–中 |
| 52 | enh | type() 一次写入整段文本，要逐字输入 | L.C | 中 |
| 54 | enh | doctor / build 假定测试项目就是 Expo app，要支持 appDir | L.D | 中–大 |
| 49 | enh | Android 无法用真实触摸操作 app 自己的对话框窗口 | L.E | 中 |
| 50 | enh | iOS inline DateTimePicker 的日期点不到 | L.E | 大（要调研） |
| 51 | enh | iOS system.* 看不到其他进程的 UI；两端都没有 system.type | L.E | 大（要调研） |

分组依据：L.A 是根因明确的小 bug；L.B 是 scroll / tap 的正确性（都改 runtime.ts / visibility / hit-test，放一起）；L.C 是 device / 输入 API 的扩展；L.D 是 CLI；L.E 是 system UI 和原生控件，要先在模拟器上调研再定方案。

## 待决定事项（2026-11-19：D1、D2、D7、D8 由 HU 选了推荐项；D3–D6 按推荐默认执行）
| ID | 问题 | 推荐 |
|----|------|------|
| D1 | #45 修哪几处 | 三处都修：① `scrollTo` 停下的条件改为「目标的中心点在滚动容器的可见区域内」（不是 ratio > 0）；② native tap 的点改为「元素可见部分（按祖先裁剪后的 rect）」的中心；③ `hitTest` 考虑 `clipsContent` 祖先的裁剪，点落在被裁掉的部分 ⇒ `ELEMENT_OBSCURED`。 |
| D2 | #48 怎么支持后台 openUrl | `app.openUrl` 在后台时不再报错：从 app 外打开（iOS `simctl openurl`，Android `am start -a VIEW -d … <package>`），iOS 出现「在 … 中打开？」时自动点「打开」，然后等 app 回到前台并 idle。不另加 `device.openUrl`。 |
| D3 | #53 setLocale 的校验 | 去掉 CFBundleLocalizations 前提；重启后读 agent 报告的 JS locale（`Intl` / expo-localization 同源）。和请求的不一致才报错，错误信息里提 CFBundleLocalizations 作为可能原因。 |
| D4 | #52 的 API 形式 | **HU 2026-11-19 改为**：`type(target, text, { perCharacter: true, intervalMs? })`，字间隔默认 80 ms（内部节奏，像拖动手势的时长），打完后等 idle。原方案（每个字后等 idle）会让 debounce 每个字都触发 |
| D5 | #54 appDir | `quiesco.config` 加 `appDir`（相对 config 文件），`--app-dir` 可覆盖；doctor 的 app 检查、`build`、`init --upgrade` 都用它。runner 包检查改为按 config 里实际的 runner（Vitest / Jest / Cucumber）来查。 |
| D6 | #55 共享 hook 的处理 | `list` 忽略 `test.beforeEach / afterEach / beforeAll / afterAll`（以及 `describe` 级同名）；runners 文档写明 hook 要在每个文件里注册或用 `setupFiles`；init 生成的 vitest config 带 `setupFiles: ['e2e/setup.ts']` 的注释示例（不默认生成文件）。 |
| D7 | #49–#51 的范围 | 先做 L.E.0 调研再定。初步：#49 Android 的 `system.*` 包含 app 自己的非主窗口（按 window 区分而不是按 package）；#51 Android 加 `system.type`（`input text` / 剪贴板）；iOS 的「其他进程 UI」「inline picker 的日期」「system.type」要看现有 iOS system UI runner 能做到哪一步，做不到的写进文档。 |
| D8 | 版本号 | 加了新 API / 新配置 ⇒ 0.8.0；所有阶段完成、三端验收后一起发。也可以先把 L.A + L.B 作为 0.7.1 发出去。 |

## Phases

### L.0 调研与计划
- [x] 读 12 个 issue，写 findings
- [x] 初步代码定位（见 findings.md）
- [x] HU 确认 D1–D8
- **Status:** complete

### L.A 根因明确的小 bug（#47、#55、#44）
分支 `fix/issues-44-47-55`。
- [x] #47 `openNotification(title, { timeoutMs })`：provider 接口多了 `timeoutMs`；Android 去掉固定 5 s，iOS 去掉固定 10 s；默认 10 s（和 `system.*` 的 `SYSTEM_WAIT_MS` 一致——DeviceHost 拿不到 `sync.timeoutMs`，见 Decisions）；iOS 找横幅的时间上限改为 min(2 s, timeoutMs/2)，短超时也会去通知中心找；错误消息带 `within Nms`。测试：device-state（默认值 / 传入值 / 非法值）、android（700 ms 内失败）、ios-runner（600 ms，打开过通知中心）
- [x] #55 `@quiesco/vitest` 的 list：Vitest 静态解析把 `test.<x>(…)` 都当测试 ⇒ 按源码位置（1-based line/column，TS 也映射回原始源码，已实测）判断是否 `*.beforeEach/afterEach/beforeAll/afterAll/aroundEach/aroundAll/onTestFailed/onTestFinished(`，是就去掉。新 fixture `packages/vitest/test/fixtures/list-hooks`（.mjs + .ts）。runners.mdx 三语加「共享 hook 放 setupFiles」；init 生成的 vitest config 带注释掉的 `setupFiles` 示例
- [x] #55 实测：Vitest 5.1 + `isolate: false` 下，setupFiles 里的 beforeEach 对每个文件都执行，共享模块里的只执行第一个文件（hits=2 / shared=1）；example app web 上用 setupFiles 的 `test.beforeEach(({ app }) => …)` 在两个文件的 5 个测试前都执行
- [x] #44 `findScrollable`：第一个 host 是 `AndroidSwipeRefreshLayout` 时取它的子节点（`SCROLL_WRAPPERS`）。单测用 issue 的树。example app playground 的 200 行 FlatList 加了 `refreshControl`
- [x] #44 实测：Android 去掉修复 ⇒「长列表滚动到指定行和两端」失败（scrollToEdge bottom 后 row-200 不可见），加上修复 ⇒ 通过；actions.feature Android / iOS / web 各 5/5
- [x] `pnpm check` exit 0（910 个测试），`docs:check --no-mint` 通过，plugin references 已重新生成
- [x] HU 确认提交 / PR：4 个 commit，PR #56
- **Status:** complete

### L.B scroll / tap 正确性（#45、#46）
分支 `fix/scroll-tap-clipping`（叠在 `fix/issues-44-47-55` / PR #56 上）。调研结果见 findings.md「L.B 调研」。
- [x] 调研：#46 两个问题都定位并做了实验修复（方向、ease-out）
- [x] #46 方向：`scrollTo` 按内容 / 视口尺寸判断横向 ⇒ right / left
- [x] #46 距离：native `scroll` 用 `easeOutPath`（cubic，10 段）经 `bridge.gesture`；`scroll()` 650 ms，scrollTo 的一步 400 ms（`ActionPerformer.scroll` 第 5 个参数 `step`）；没有 gesture 的旧 app 仍是 500 ms 匀速 swipe
- [x] #45 ①：`scrollTo` 等 `isCenterVisible`；滚到头时退回到 `isVisible`；每步 0.85 × 视口（不跳过元素）
- [x] #45 ②：native `tap` / `longPress` 和 host（web）`tapAt`（含 multiTap）在只露出一部分时点 `visibleCenterPoint`
- [x] #45 ③：`hitTest` 里 clipsContent 的节点不包含该点时，不再访问它的子节点
- [x] #44 补充（web）：RNW 的 RefreshControl 也包了一层 View，并带 ScrollView 的 style（overflowY auto）⇒ L.A 的按名字判断不够。改成结构判断：唯一子节点也裁剪内容、两者 rect 相差 ≤ 4 ⇒ 包装层（三端通用，去掉了名字表）。L.A 时 web 的「5/5」用的是旧 dist（没有 refreshControl），不能算 #44 在 web 上的验证
- [x] example：playground 长列表加横向 carousel 表头（10 张）；行和张可点击（结果写到 tap-result）；actions.feature +3 场景（长列表 scrollTo + 点击、横向列表 scrollTo + 点击、@needs-touch 按距离滚动 ±20%）
- [x] 单测：runtime（横向 scrollTo、1 pt 时继续滚）、hitTest 裁剪、native / host 点可见部分中心、easeOutPath、web 包装层；没有修复时 runtime 两个新测试都失败（已确认）
- [x] 实跑：actions.feature 三端各 8/8；距离（distance → 实际）iOS 240→230，Android 240→224，web 240→240；scrollTo 到第 120 行 iOS 7.3 s / Android 7.7 s / web 2.6 s（0.7.0 的代码在 iOS 上 10 s 内到不了）
- [x] 文档三语 api.mdx（tap、scroll、scrollTo、ELEMENT_OBSCURED）；`pnpm check` exit 0（917 个测试）；docs:check 通过
- [x] HU 确认提交 / PR：PR #57（base 是 PR #56 的分支；PR 正文里更正了 #56 的 web 说明）
- **Status:** complete

### L.C device / 输入 API（#48、#53、#52）
分支 `feat/device-input-l-c`（叠在 `fix/scroll-tap-clipping` / PR #57 上）。调研见 findings.md「L.C 调研」。
- [x] 调研：#48 iOS 确认框可由 runner 点掉（实测）；#53 Intl 和首选语言的差别；#52 web 已逐字
- [x] D4 重新确认（HU 2026-11-19）：固定间隔（默认 80 ms），打完后等 idle；不是每个字等 idle
- [x] #48 provider `openUrlFromOutside`（iOS：simctl openurl + runner 点 2 按钮 alert 的右边按钮，5 s 内没有确认框就不点；Android：am start VIEW）；`Driver.openUrl` 在 background 时交给 `DeviceApi.openUrlInBackground`（等 active → reapplyConfig → idle）；terminated 仍是 APP_NOT_RUNNING
- [x] #53 protocol `DeviceInfo.preferredLanguages`；agent 从 SettingsManager（TurboModuleRegistry，退回 NativeModules）读 AppleLanguages；setLocale：首选语言或 Intl 对上即通过，只有首选语言对上时 warn
- [x] #52 `type(target, text, { perCharacter, intervalMs })`（core `TypeOptions`，默认 80 ms；intervalMs 没有 perCharacter ⇒ TypeError）；protocol `intervalMs`；native / js 按字素（`characters()`，Intl.Segmenter，退回码点）；web `keyboard.type(text, { delay })`
- [x] #52 Android 实测：聚焦点击后马上逐字提交会丢第一个字（IME 启动，3 次里 2 次「tem 04」）⇒ native `type` 在聚焦后先 `settle()`（runtime 注入的 waitForIdle）⇒ 3/3 通过
- [x] example：设备页加「首选语言」（iOS Settings.get('AppleLanguages')）；playground 加 300 ms 防抖搜索框；场景：actions「逐字输入」「一次输入（@native；web 本来就逐键）」、device「切换到 App 没有声明的语言（fr-FR）」、lifecycle「在后台时打开深链接（@native）」
- [x] 单测：core（device-state 后台 openUrl、JS-only locale + warn；driver type spec / 校验；ios-runner / android provider）、agent（native 逐字 + settle 顺序、js 逐字、characters、host intervalMs、preferredLanguages）、web（intervalMs 节奏）
- [x] 实跑：actions + device + lifecycle：iOS 34 + 1 skipped；web 31 + 4 skipped；Android 34 / 35，唯一失败「模拟定位」是 AOSP 镜像没有 Google Play 服务（改动前同样失败，已确认）
- [x] 文档三语（type / openUrl / setLocale）；`pnpm check` exit 0（928 个测试）；docs:check 通过
- [x] HU 确认提交 / PR：PR #58（base 是 PR #57 的分支）
- **Status:** complete

### L.D CLI：appDir（#54）
分支 `feat/app-dir`（叠在 `feat/device-input-l-c` / PR #58 上）。调研见 findings.md「L.D 调研」。
- [x] core：`QuiescoConfig.appDir`；`loadConfig` 按 config 文件目录解析成绝对路径（不是非空字符串 ⇒ CONFIG_ERROR）；session 的 bundle 检查用 `config.appDir ?? cwd`
- [x] cli `app-dir.ts`：`appContext(ctx, config, flag)`（`{ ...ctx, cwd: appDir }`，同目录返回 ctx 本身）、`inApp`（显示路径；离得远就用绝对路径）
- [x] doctor：先读 config；app 侧（expo、@quiesco/agent、config plugin、Metro、entry、<QuiescoRoot>、app.json / android/）在 appDir，测试侧（runner 包、旧版文件、config、构建脚本）在 cwd；版本检查合并两边（app 的包带 `(app)`）；`--app-dir`；分目录时第一行 `app: …`
- [x] build：prebuild / xcodebuild / gradle 在 appDir；binaryPath 仍相对 cwd（xcodebuild 的 derivedDataPath 换算成相对 app）；stamp 在 appDir/.expo；`--app-dir`
- [x] init --upgrade：agent / native / expo-plugin 在 app 里升级，其余在测试包；app.json ID、<QuiescoRoot> 在 app，cucumber / tsconfig / config 占位符 / scripts 在测试包；`--app-dir`
- [x] `quiesco test`：Metro 在 appDir 启动
- [x] 帮助文本、cli.mdx 三语新节「测试放在单独的包里」
- [x] 单测：cli `app-dir.test.ts` 8 个（appContext、doctor 通过 / 不设 appDir / --app-dir / 版本不一致、build android / iOS、upgrade、Metro）；core config（appDir 解析）、device-state（bundle 检查看 appDir；去掉 session 改动则失败）；fake context 记录 cwd
- [x] 实跑：scratchpad 里的独立测试包（appDir 指向 examples/todo-app，node_modules 按包软链）：doctor 全部通过（runner 识别为 Vitest，11 个包 0.7.0）；iOS（Metro 在 app 目录启动、结束后停掉）3/3、web 3/3。原目录：doctor 通过，web actions 9 + 1 skipped
- [x] `pnpm check` exit 0（938 个测试）；docs:check 通过
- [x] HU 确认提交 / PR：PR #59（base 是 PR #58 的分支）
- **Status:** complete

### L.E system UI 与原生控件（#49、#50、#51）
分支 `feat/system-ui-l-e`（叠在 `feat/app-dir` / PR #59 上）。调研见 findings.md「L.E.0 调研」。
HU 2026-11-19：E1 自动包含 app 自己的原生 UI；E2 其他 app + 关闭分享面板，并装 expo-web-browser 实测认证会话；E3 iOS typeText、Android input text + 剪贴板粘贴。
- [x] L.E.0 调研（Android 对话框窗口、adb 真实点击；iOS runner snapshot：app 的 UIKit、键盘、inline 日期、Safari、分享面板）
- [x] 实施计划（HU 2026-11-19 确认）
- [x] runner：`/elements`（snapshot 一次取整棵树；snapshot 只有根节点时改为按类型查询：分享面板、SafariViewService 的远程视图要靠它）、`/typeText`（先等键盘，没有就 409，不让 XCTest 失败停掉 runner）
- [x] provider：`SystemNode.app` / `field`；`typeSystemNode`、`tapSystemPoint`。iOS `systemNodes` = SpringBoard + 前台的 SafariViewService / Safari + app 的 UIKit；打字按字发（RN 受控输入框跟不上整段，"ann" → "an"），没有键盘就换前台的其他 app。Android `systemNodes` 在 app 有对话框窗口（dumpsys `ty` ≠ BASE_APPLICATION）时包含 app 的节点；节点文字 text → content-desc → hint；ASCII 用 `input text`（含 `%s` 时改粘贴），其他文字用 @quiesco/native 剪贴板 + KEYCODE_PASTE；`tapSystemPoint` 按 `wm density` 换算
- [x] DeviceApi：`system.type(query, text)`（同名时优先输入框）、`system.tapAt({ x, y })`
- [x] example：expo-web-browser（iOS / Android 重建）、mock server `/auth` 登录页、system 页（网页登录、分享、inline 日期、输入框：Android 在 Modal 里，iOS 在页面上）；场景：网页登录（@ios）、分享面板出现 / 关掉（@ios）、inline 日期（@ios）、系统输入 ASCII / 中文（两端）、values「日期对话框真实触摸」（@android）
- [x] 实测中修的问题：testID 重名（auth-result）；iOS「Wants to Use … to Sign In」先点 Continue；label 和输入框同名 ⇒ 优先输入框；登录页标题和按钮同名 ⇒ 改标题；Android `%` 被多加反斜杠；iOS 整段输入丢重复字母；第二次显示的 RN Modal 在 snapshot 里只剩根节点（按 window snapshot 能拿到但 12 s，弃用）⇒ example 的 iOS 输入框放在页面上，文档写明；分享面板关闭的时机 ⇒ 等出现、点、等消失
- [x] Android 网页登录：AOSP 镜像只有 WebView shell，不支持 Custom Tabs，app 被重启 ⇒ 场景 @ios，文档写明
- [x] 单测：android（对话框窗口、hasDialogWindow、type ASCII / 粘贴 / %s、tapAt）、ios（uikitNodes、systemNodes 顺序、按字打字、键盘回退）、device-state（system.type / tapAt）
- [x] 实跑：system.feature iOS 14 + 4 skipped、Android 11 + 7 skipped；values.feature Android 通过
- [x] 文档三语（api：system.type / tapAt、系统 UI 包括什么；platforms 表）；`pnpm check` exit 0（945 个测试）
- [x] 三端全量回归（第一次）：web 84 + 21 skipped；Android 95 / 105（「模拟定位」：AOSP 没有 Google Play，同以前）；iOS 96 / 105，values.feature 2 个失败 = **L.B 的回归**：scrollTo 每步 0.85 视口，拖动起点落在 controls 页的滚轮选择器上（UIPickerView 吃掉拖动）⇒ offset 不变 ⇒ 判断为到头
- [x] 修复：一步拖动后 offset 没变、但这个方向还有内容（`js.atEdge`）⇒ 这一步改用程序化滚动。runtime 单测（没有修复时失败）；values + actions iOS / Android 各 21 + 1 skipped；`pnpm check` 946
- [x] iOS 全量回归（第二次）：105 scenarios（98 passed, 7 skipped），0 失败
- [ ] HU 确认提交 / PR
- **Status:** in_progress

### L.F 发布
- [ ] CHANGELOG、版本号（D8）、三端全量 e2e
- [ ] 回复并关闭 #44–#55
- **Status:** pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| D1 #45 三处都修 | 只改一处仍会留下静默点错的路径 |
| D2 #48 app.openUrl 直接支持后台 | 不加新 API，用户直觉写法就能用 |
| D7 #49–#51 先调研 | iOS 能力取决于现有 system UI runner，先看清再定 |
| D8 全部完成后发 0.8.0 | 有新 API / 新配置 |
| #47 默认等 10 s（不是 sync.timeoutMs） | DeviceHost 没有 sync 配置；和 system.* 的默认值一致，调用方可传 timeoutMs |
| #44 按 host 名跳过 AndroidSwipeRefreshLayout | 结构判断（同 rect）会和内容不足一屏的普通 ScrollView 混淆 |
| #44 包装层用结构判断（唯一子节点也裁剪、rect 基本相同） | RNW 的包装层是普通 div，Android 的带 overflow: scroll；名字和 clipsContent 都不能单独区分 |
| scroll() 650 ms / scrollTo 一步 400 ms | 650 ms 时 iOS 的 scrollTo（120 行）超过 10 s；400 ms 时 Android 距离少 14% |
| #52 逐字输入前先 settle（waitForIdle） | Android 上 IME 启动时会丢掉刚提交的字；固定等待 500 ms 也能过，但 idle 等待不依赖时长 |
| web 的 type 默认行为不变（本来就逐键） | 改成一次写入会影响依赖 keydown 的 web app |
| #55 按源码判断 hook 调用 | Vitest 静态解析的结果里没有调用的方法名，只有位置 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
