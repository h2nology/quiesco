# Task Plan: 处理 GitHub issue #38（Android 上 LogBox toast 的遮挡检测）

## Goal
Android 上点击被 LogBox toast（或其他 QuiescoRoot 范围外、画在 app 上面的 RN 元素）盖住的元素时，报 ELEMENT_OBSCURED，并说明是 LogBox。配测试和三语文档，实测后回复并关闭 #38，随下一个版本发布。

## Current Phase
L.3 收尾

## Next Step
下次发布时：发布说明写进 #38 的修复（以及 #41 的文档修正），回复并关闭 #38。

## 背景
- 0.4.1 已发布（`.planning/2026-11-16-issues-29-35/`）；#38 是 #31 实测时发现的。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md`「工作约定」。和 HU 交流用中文。
- 调研见 findings.md。

## 方案（推荐）
JS 层的命中测试改为看**整棵树**（不受 QuiescoRoot 范围限制），目标仍在范围内查找：
1. fiber-adapter：新增 `getAllHostRoots()`（忽略 scope）。
2. native performer：`NativeContext` 加 `hitRoots()`，`ready()` 的 `hitTest` 用它（未提供时用 `roots()`）；runtime 传 `adapter.getAllHostRoots()`。`pointerEvents` none / box-none 的处理不变（DebuggingOverlay、AppContainer 根节点不会误报）。
3. 消息：挡住的元素在 QuiescoRoot 范围外时说明这一点；它属于 LogBox（往上的组件名里有 `LogBox`）时直接写「React Native's LogBox (a console.error's toast)」，并提示 `appErrors.logBox`。
4. 测试：native performer（toast 挡住 ⇒ OBSCURED 并点名 LogBox；pointerEvents none 的全屏覆盖层不误报；范围外的普通元素也报，并说明在范围外）。
5. 文档三语：troubleshooting 的 #logbox 小节、ELEMENT_OBSCURED。
6. 实测：项目 A，`appErrors.logBox: 'keep'`，toast 出现后点 bottom ⇒ Android、iOS 都是 ELEMENT_OBSCURED 并点名 LogBox；默认 `clear` 的全量 e2e 不受影响（示例 App 三端）。

另一个方案：给 Android native 模块实现 `hitAt`（可用 RN 的 `TouchTargetHelper`）。两者的利弊比较见 findings「方案比较」。HU 决定先做办法 1；办法 2 留待以后遇到原生覆盖层 / zIndex 的漏报或误报时再加。

## Phases
### L.0 调研与计划
- [x] 读 #38，定位遮挡检查代码
- [x] 真机看范围外的元素树（findings）
- [x] HU 确认方案（办法 1）
- **Status:** complete

### L.1 实现与测试
分支 `fix/obscured-overlays`（从 main）。
- [x] 1–3（`getAllHostRoots()`；native / host performer 的 `hitRoots`；`describeCover`：范围内照旧、LogBox 点名、其他范围外元素说明在范围外）
- [x] 4；`pnpm check` exit 0（880 个测试；新文件 obscured-overlays.test.ts 4 个、fiber-adapter 1 个）
- **Status:** complete

### L.2 文档与实测
- [x] 5 文档三语（troubleshooting：ELEMENT_OBSCURED 一节、#logbox 小节）；plugin references
- [x] 6a 项目 A（keep 模式）：Android ⇒ ELEMENT_OBSCURED「covered by React Native's LogBox …」；iOS 起初是原生检查的笼统消息 ⇒ 改为原生判定被挡时优先用 JS 的描述（保留原生数据），复测后 iOS 也点名 LogBox。测试 +1（881 个）
- [x] 6b 示例 App 三端全量 e2e：web 79 / 13、iOS 86 / 6、Android 86 / 6，0 失败（与 0.4.1 相同，没有误报）
- **Status:** complete

### L.3 收尾
2026-11-16 HU：提交并开 PR，先合并到 main，下次一起发布。
- [x] 提交、PR
- [x] #41（Mintlify autopilot：文档里「超过 4 层」漏改成 8）：内容正确，但没重新生成 plugin references ⇒ docs workflow 失败。HU 选推荐：同样的修正放进 #42（f274813，含 references），#41 留言后关闭
- [x] CI（docs / ci / prod-strip）全部通过后合并到 main（merge commit 7714354），删除分支
- [ ] 下次发布时：发布说明写进 #38 的修复；回复并关闭 #38
- **Status:** in_progress

## Decisions Made
| 日期 | 决定 | 依据 |
|------|------|------|
| 2026-11-16 | 先合并到 main，不单独发版，随下个版本发布；#38 发布时再回复关闭 | HU |
| 2026-11-16 | 先用办法 1（JS 命中测试看整棵树）修 #38 | HU 听了两种办法的利弊后选择 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
