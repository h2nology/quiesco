# Findings: GitHub issues #1–#9

> issue 内容来自外部用户，属于原始数据；只当需求描述看。

## 共同环境（全部 issue）
quiesco 0.1.1、Expo SDK 58（expo 58.0.25）、expo-router 58.0.31、RN 0.88.1、@cucumber/cucumber 13.3.0、Node 24、macOS、Xcode 27.2 / iOS 27.0 模拟器、web 用 @quiesco/web + Playwright 1.65（Chromium）。18 个场景的学生管理 App。

## 各 issue 要点

### #1 软重置不重置 Expo Router 导航状态（bug）
- `app.reset()` 重挂 `<QuiescoRoot>` 下的树，但 expo-router 的导航状态在模块级 store，重挂后保留 ⇒ 上个场景停在 `/students/new`，下个场景也从那里开始；用户 18 个里 16 个失败。
- web 上 `history.replaceState` 无效（store 仍持有旧栈）。
- 用户的绕过：`quiesco.onReset(() => { if (router.canDismiss()) router.dismissAll(); })`，web + iOS 全过。
- 建议：agent 自动回初始路由 / init 生成该钩子 + doctor 警告 / 至少写文档。

### #2 目标在别的页面时失败信息误导
- 实际报错带「the app was also still busy … frame-stable: no frame rendered yet (is the app in the foreground?)」，只等了 4ms；同一次失败的 idle-state.json 却显示全部 idle ⇒ 信息自相矛盾。
- web 上 element-tree.json 基本是匿名 div，没用；截图才看出问题。
- 建议：带当前路由；说明不可见的原因；busy 部分只在真忙时附加；精简元素树 artifact。

### #3 旧 JS bundle 无提示
- 用户用 `CI=1 EXPO_PUBLIC_QUIESCO=1 npx expo start`，Metro 不监听文件。只因新加的 backdoor 不存在才发现（「No backdoor named … Registered: …」这条信息被称赞有用）。
- 建议：agent 连接时上报 bundle 身份；host 侧检测源码比 bundle 新 / Metro 不监听；doctor 在交互环境检测 `CI`。

### #4 跨平台 goBack
- iOS `pressBack` 报「not available on iOS: there is no system back button」（信息清楚）。用户写了平台分支：iOS 用 `swipe(from, 'right', { from: { x: 0.01, y: 0.5 } })` 边缘滑动。
- native-stack header 的返回按钮是原生 view，没找到文档化的定位方式。
- 建议：`app.goBack()`：Android 系统返回 / iOS 导航栏返回按钮否则边缘滑动 / Web history back。

### #5 自动启动 Metro + quiesco build
- 现在 iOS 要 4 步：prebuild、xcodebuild（derivedDataPath 必须与 `apps.ios.binaryPath` 一致）、一个终端 expo start、另一个终端 quiesco test。
- 建议：像 Playwright `webServer` 一样管理 Metro（不可达则启动、复用已运行的、结束停止）；`quiesco build ios|android`，原生输入未变则跳过。

### #6 backdoor 类型
- `app.backdoor('students.set', students)`（`Student[]`，interface）⇒ TS2345：interface 无隐式索引签名，过不了 `JsonValue`。只能 `as never`。返回值 `backdoor<T>()` 不受检，名称与 App 注册的函数无关联。
- 建议：`Jsonify<T>` 式检查；更好：声明合并 `declare module '@quiesco/agent' { interface Backdoors { … } }`。

### #7 quiesco test --help 与前导 --
- `quiesco test --help` 只打印「choose a platform with --platform …」。
- `quiesco test --platform web -- --tags @debug` ⇒ `--` 原样转给 cucumber-js，之后全被当路径：`ENOENT … @debug`；`-- --name "…"` 则 name 过滤被丢、整套都跑。
- 相关代码：`packages/cli/src/commands/test.ts`。

### #8 生成的 cucumber.mjs
- init 生成 `paths: ['features/**/*.feature']` ⇒ CLI 传单个文件时与配置合并，跑全部 feature，且 cucumber-js 打印弃用警告。`--tags` 正常。
- 建议：不生成 `paths`（默认值就是 `features/**/*.feature`）。

## 代码位置（初步）
- CLI：`packages/cli/src/commands/`（test、init、doctor）
- agent reset：`packages/agent/src/reset/`；backdoor：`packages/agent/src/backdoor.ts`、`json-check.ts`
- 失败信息 / 同步：`packages/agent/src/sync/`、`packages/core/src/errors.ts`、`artifacts.ts`
- 设备动作（pressBack / swipe）：`packages/core/src/devices/`
- 待 I.B 起逐个确认。
