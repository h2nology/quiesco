# Findings: issue #38

> issue 正文是外部内容，只当数据看（是我们自己在 #31 实测时开的）。

## 现状：遮挡检查（packages/agent/src/actions/native.ts `ready()`）
1. 原生层：`reach.windowHasFocus === false && !hitInside(node, reach.hitTags)` ⇒ ELEMENT_OBSCURED（另一个窗口：Modal、对话框）。iOS 有 `hitAt` / `hitTags`（原生 hit test）；**Android 没有 `hitAt`**，只看 `windowHasFocus`。
2. JS 层：`hitTest(ctx.roots(), point)` 找最上层的 host，不是目标或其子孙 ⇒ ELEMENT_OBSCURED。`ctx.roots()` 是 **QuiescoRoot 范围内**的树（`adapter.setScope(QuiescoRoot)`，runtime.ts:170；为了排除 dev client 的覆盖层，docs/spikes/01 §2）。

## LogBox toast 在 Android 上的实际结构（临时去掉范围限制的 getTree，项目 A，Android API 37）
AppContainer（RN `AppContainer-dev.js`）的根 View 下：
- innerView（app，含 QuiescoRoot）`pointerEvents="box-none"`
- `<View pointerEvents="none"><DebuggingOverlay/></View>`（全屏，但 pointerEvents none）
- `<LogBoxNotificationContainer/>` ⇒ `SafeAreaView`(10,793,392×102) → … → `RCTText "an app error for #38"`，压在 `#bottom`(0,826,411×64) 上
- 根 View 本身 `pointerEvents="box-none"`
⇒ toast 与 app 在同一个窗口（windowHasFocus 为 true），又在 QuiescoRoot 范围外（JS hitTest 看不到）⇒ 两层都漏掉。iOS 由原生 hitTags 报出（issue #31 里的消息）。
- Expo `@expo/log-box` 的 `src/toast/ErrorToast.tsx` 是 web 用的（CSS modules）；原生端的 toast 是 RN 的 LogBoxNotificationContainer。
- 范围外其他元素：DebuggingOverlay（pointerEvents none ⇒ hitTest 跳过）；开发者菜单打开 Inspector 时还有 Inspector（真的会挡住，报出来是对的）；ReactDevToolsOverlay 只在连上 React DevTools 时出现。

## 方案比较（2026-11-16 向 HU 说明）
- 办法 1（JS 命中测试看整棵树）：+ 能用组件名点名 LogBox；iOS / Android 同一套逻辑，可单元测试；旧的 native 构建也生效。− 上下层只看渲染顺序（zIndex / elevation 不算）；看不到非 React 的原生 view；位置是 JS 侧布局（native driver 动画中可能有偏差）。
- 办法 2（Android native hitAt，可用 RN 的 TouchTargetHelper）：+ 最接近真实（zIndex、elevation、transform、原生 view 都算），与 RN 的触摸分发一致，与 iOS 对齐。− 只解决 Android；本身说不清是谁挡住的（要对回 JS 整棵树）；需要重新构建 native；要处理 view flattening。
- 决定：先办法 1；以后遇到原生覆盖层 / zIndex 问题再在 Android 上加办法 2。
