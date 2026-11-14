
## I.B 调查（#1、#9）
- agent 软重置：`packages/agent/src/reset/index.ts` `ResetManager.run`：storage → onReset 钩子 → remount（QuiescoRoot 改 key）。失败抛 `RESET_FAILED`（带 step 名）。
- 可选依赖写法已有先例：`reset/storage-defaults.native.ts` 在 `try` 里直接 `require('@react-native-async-storage/async-storage')`（Metro `allowOptionalDependencies` 默认开），没装也能打包。
- expo-router 58.0.30（examples/todo-app/node_modules）：
  - 公开 `useNavigationContainerRef()`（`build/hooks/useNavigationContainerRef.js`）直接返回模块级 `navigationRef`（TODO 写着以后可能改走 context ⇒ 在 QuiescoRoot 渲染里当 hook 调用最稳，QuiescoRoot 在容器内部）。
  - `fork/NavigationContainer.js`：expo-router 总是在渲染容器前生成完整的初始 state（`getInitialState`，来自初始 URL）⇒ 挂载时 `getRootState()` 的快照就是「初始状态」。
  - `router.dismissAll()` 只回到最近一个 stack 的第一页，不处理 tabs / 嵌套 ⇒ 不用它，用 `navigationRef.resetRoot(快照)`。
- 示例 App 没碰到 #1：QuiescoRoot 包着 `<Stack>`（在 _layout 里），且场景大多从登录 / backdoor `router.push` 开始。示例 onReset 只清 todo 数据。
- 历史坑（2026-11-07 findings）：软重置时 expo-router 会重挂根 layout，QuiescoRoot 卸载再挂载 ⇒ 已靠「延迟一个 tick 再 stop」解决；改 reset 时别破坏。

### I.B 设计（草案）
1. agent 新增 `navigation/expo-router.ts`：首次渲染 QuiescoRoot 时懒加载 `try { require('expo-router') }`，得到 `useNavigationContainerRef` 或 null（结果缓存，hook 调用顺序不变）。
2. QuiescoRoot 把 ref 交给 runtime；runtime 在 ref ready 时存初始 root state 快照（挂载时未 ready 则等 ready；第一次 reset 时还没有就当场拍）。
3. ResetManager：storage → onReset → **navigation（`resetRoot(快照)`）** → remount。
4. 当前路由：从 root state 沿 focused route 取名字拼路径（去掉 `index`、`(group)`、`__root`），给 #2 / #9 共用。
5. D2 校验：reset + idle 后当前路由 ≠ 快照路由 ⇒ reset 失败、信息写清；可选 `quiesco.config` 里配置一个必须可见的元素。
6. D4：@quiesco/cucumber 记录每个失败场景的签名（失败 step 的错误 code + 去掉数字 / 时长的消息），连续 N（默认 3）个相同 ⇒ 打印提示（含当前路由），之后的场景在 Before 里返回 skipped。

### I.B 实测（2026-11-15）
- **示例 App 复现不了 #1**：`examples/todo-app` 的 `App` 在 `store.restoreSession()` 完成前 `return null`，QuiescoRoot 重挂时 Stack 被完全卸载 ⇒ 容器里它的状态被丢掉、重建为初始。未修代码时新加的 `soft-reset.feature` 也通过。⇒ 用 issue 的布局（QuiescoRoot 下直接 `<Stack />`、无加载闸门）做复现。
- 复现 App：复制 release 时的 smoke（create-expo-app，SDK 58，expo-router 58.0.31）到 scratchpad `ib/smoke`，_layout 改为 `QuiescoRoot > Stack`，index（testID home + go-details 按钮 push `/details`），4 个场景 A 停 details / B 期望 home / C / D。
  - 0.1.0：web 1 passed / 3 failed（34.7s，每个等满 10s）⇒ 复现。
- **expo-router 58 的容器没有 `resetRoot`**：`build/react-navigation/core/BaseNavigationContainer.js` 的 imperative handle 只有 CommonActions（navigate / reset / goBack …）、dispatch、getRootState、isReady（固定 true）等；`createNavigationContainerRef` 的包装也一样 ⇒ 用 `ref.reset(rootState)`（CommonActions.reset 发给根 navigator）。保留 `resetRoot` 优先（React Navigation 原版）。
  - 修后：web 4/4 通过（1.5s）。
- 「Requiring unknown module "8xx"」redbox 在修前修后都有（被忽略的 app error），与本修改无关。
