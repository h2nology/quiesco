# Progress: issue #38

## 2026-11-16 会话 1
- 新建计划 `2026-11-16-issue-38`。
- 调研：遮挡检查两层（原生 windowHasFocus / iOS hitTags；JS hitTest 只看 QuiescoRoot 范围）。在项目 A 临时去掉 getTree 的范围限制（scratchpad 里改已安装的 agent，已还原），确认 Android 的 toast 是 AppContainer 下 QuiescoRoot 范围外的 RN view，压在 #bottom 上。
- 写出方案，等 HU 确认。
- HU 选办法 1。分支 fix/obscured-overlays。实现 + 测试，`pnpm check` exit 0（880 个测试）。
- 文档三语。项目 A 实测：Android、iOS 都报 ELEMENT_OBSCURED 并点名 LogBox（iOS 需要让 JS 描述优先于原生的笼统消息，已改）。`pnpm check` exit 0（881）。示例 App 三端全量 e2e：跑着。
- 示例 App 三端全量 e2e 0 失败（web 79/13、iOS 86/6、Android 86/6）。等 HU 确认提交 / PR。
- HU：提交并开 PR，先合并到 main，下次一起发布。
- #41（Mintlify autopilot）check 失败：plugin references 没重新生成。内容是对的（K.D 漏改文档里的 4 层）。修正放进 #42（f274813），#41 留言后关闭。
