# Progress: issues #82–#87

## 2026-11-20 Session 1
- gh issue list：open 6 个（#82–#87），均为 0.10.0 实测反馈。
- 代码定位写入 findings.md；task_plan.md 列出 D1–D5 待确认。
- HU 确认 D1–D5 全部按推荐；进入 N.A。
- N.A 分支 fix/ios-system-ui-timing：provider systemUiSettleMs + findSystemNode 两次一致；tapAt 等稳定；tapOpened 轮询中点 revealed "Open"；sendToBackground 预热 runner（startRunner 共享 promise）；三语文档；单元测试 55 + 1 通过。
- iOS system.feature 第一轮 3 次：5–7 失败（settle 全量重读太慢，见 findings）⇒ 改为只重读 SpringBoard；第二轮后台运行中（scratchpad sysB-*.log）。
- N.A 完成：pnpm check 993；PR #88。
- N.B 完成：pnpm check 996；PR #89（叠在 #88）。
- N.C 完成：pnpm check 991；PR #90（基于 main）。
- N.D：集成分支 tmp/integration-82-87（本地，#89+#90 合并），三端全量后台运行（scratchpad full-ios/android/web.log）；回复草稿 scratchpad replies/82–87.md（VERSION 待定）
- HU 要求一起修中文打字已有问题 ⇒ 新增 N.E。分析：element-tree 坐标整体偏 (315,712) ⇒ 坐标校准错误。三端并行全量：Android / web 端口冲突未跑，iOS 进行中。
- N.E：根因 = native viewWithReactTag 找到 UITextEffectsWindow 里的同 tag view；原生 + JS 两处修复；JS 防线实测 ×3 通过；iOS App 重建 + Android 全量后台进行。
- N.E 完成：原生单独实测通过；PR #91。集成分支加入 #91，三端全量依次后台运行（full2-*.log）。
- 全量2：web 85/24/0、Android 99/9/1（定位，已知）、iOS 100/7/2（通知 ⇒ 修 BANNER_WAIT 5 s，×12 通过；showcase 空白画面偶发）。iOS 全量重跑中（full3-ios.log）。
- iOS 全量重跑 102/7/0。合并 #88–#91（main a201e0e）；0.11.0 release:check ok（999 tests），本地提交 0dbc1ef；等 main workflows。
