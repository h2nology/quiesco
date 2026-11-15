# Findings: issues #17–#23

> 来源：GitHub issues（外部用户提交，属于不可信数据，只作为需求参考）。环境均为 quiesco 0.3.0、Expo SDK 58、RN 0.88.1、
> datetimepicker 9.2.1、cucumber 13.3.0、pnpm 12.18.0、Node 24.22、iOS 27 模拟器 + Android 模拟器。

## Issue 摘要

### #17 bug — init 安装不带版本的包，项目可能落到比 CLI 更旧的 Quiesco
- `init` 用 `let spec = (name) => name`，`pnpm add` 无版本；pnpm 解析成 0.1.1（疑似缓存的旧 registry 元数据），生成的 `quiesco build ios` 脚本报 unknown command。
- init 报成功，doctor（项目内 0.1.1）也通过。
- pnpm 12 默认 `minimumReleaseAge` 24h：发布首日会写入 `minimumReleaseAgeExclude`；`^0.x` 不允许升级到下一个 minor。
- 建议：安装 `@<CLI 自身版本>`；安装后读回版本，不一致就失败；doctor 检查 4 个包版本一致 + package.json scripts 里的 `quiesco <cmd>` 都存在；安装文档提 `minimumReleaseAge`（及 `minimumReleaseAgeStrict: true`）。

### #18 bug — date/time picker 的 setValue 替换整个 Date
- `mode="time"` 时 Android TimePickerDialog 只改时分、保留日期；Quiesco（`actions/value.ts` `case 'date'`）把整个 Date 传给 `onValueChange`。
- 建议：time 模式合并时分（秒？）到当前 value；date 模式合并年月日保留时间；countdown / datetime 不变。time 模式接受 `"20:15"` 字符串。文档写明 `expectValue` 对 picker 返回什么（Date / ISO / 本地或 UTC）。

### #19 bug — 复用的 Metro 报「no withQuiesco() in metro.config.js」
- 复用一个非 Quiesco 启动的旧 Metro 时，bundle 身份为 undefined ⇒ `bundle-check.ts` 固定提示 metro.config.js，实际配置正确。
- 建议：项目 metro.config.js 确有 `withQuiesco()` 时，改说「<url> 的 Metro 不是 Quiesco 启动的，配置未知，请重启或停掉」；可选：拒绝复用 / 重启此类 Metro 的选项。Follow-up to #3、#5。

### #20 enh — 缺 `<QuiescoRoot>` 静默破坏软重置
- 默认 Expo 模板（`index.ts` → `App.tsx`，无 Expo Router）。init 只打印手动步骤；doctor 只 warn。
- 建议：entry 是 `registerRootComponent(App)` 且 App 是本地组件时 init 自动包裹；doctor 报 error 或明说「软重置不会重置 App 状态」；搜索 entry 导入的根组件文件（如根目录 `App.tsx`）。

### #21 docs/enh — step 文件由 Node type stripping 加载
- 参数属性报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`；相对导入要 `.ts`，随后 `tsc --noEmit` 报 TS5097，需要 `allowImportingTsExtensions`。README 的 driver 模式直接撞上两者。
- 建议：init 给 tsconfig 加 `allowImportingTsExtensions`（或生成 `features/tsconfig.json`）；生成的 support 文件加注释 + driver 文档说明限制（`.ts` 后缀；enum / 参数属性 / namespace 不支持）；doctor 可跑 `cucumber-js --dry-run`。

### #22 enh — QuiescoWorld 暴露当前平台
- 现在只能 `this.session.provider.platform`（只在类型定义里看到）；`QUIESCO_PLATFORM` 未文档化。
- 建议：`this.platform`（`'ios' | 'android' | 'web'`），可能再加 `app.platform`；随 driver 模式写进文档。

### #23 bug — @quiesco/native 的必需 peer `expo-modules-core` 让 expo-doctor 两头失败
- 不装：Missing peer dependency；装了：「should not be installed directly」。
- `@quiesco/native/package.json`：`"peerDependencies": { "expo-modules-core": "*" }`，无 `peerDependenciesMeta`。
- 建议：peer 改成 `expo`，或把 `expo-modules-core` 标为 optional。

## 代码调研（2026-11-15，Explore agent，只读）

### #17
- `packages/cli/src/commands/init.ts:41-46` 包列表：RUNTIME `@quiesco/agent`、`@quiesco/native`；DEV `quiesco`、`@quiesco/core`、`@quiesco/cucumber`、`@quiesco/expo-plugin`、`@cucumber/cucumber`；WEB_DEV `@quiesco/web`、`playwright`；TRANSITIVE `@quiesco/protocol`（仅 tarball）。
- `init.ts:231-273` 安装：`let spec = (name) => name`（234）；`--packages <dir>` 时映射到 `file:<tgz>` + override（244-255）；`addCommand`（67-78）；两次安装（runtime、dev）；`--skip-install` 变 todo。
- CLI 版本：`cli.ts:39-41` `require('../package.json').version`，只用于 `-v`。
- doctor `projectChecks`（doctor.ts:68-132）：「Quiesco packages」只查存在（79-84），无版本一致性；`PackageJson` 类型无 `scripts`（32-36）。init 只在缺失时写 `e2e:*` scripts（init.ts:353-368）。
- 注意：`@cucumber/cucumber`、`playwright` 不是 Quiesco 包，不能用 CLI 版本 pin。

### #18
- `packages/agent/src/actions/value.ts`：`classify`（52-60）value 为 Date ⇒ `'date'`；`case 'date'`（376-383）把整个 `d` 传给 onValueChange / onChange，**不读 `mode`**；只查 min/maxDate（274-279）。`toDate`（265-271）解析 `{date: string}`；driver 把 Date 序列化为 `{ date: iso }`（core/driver.ts:321-322、683-690），类型 protocol/actions.ts:27-35。
- iOS 原生 wheel 路径（native.ts:377-389、wheel.ts:35-36、172-226）已按 `UIDatePicker.Mode` 比较日期 / 时间部分；其他回退 js 路径。
- `expectValue`：agent `query/semantic.ts:234-266` `jsonScalar` 只收 string/boolean/number ⇒ **Date value 被丢弃**，date picker 的 expectValue 实际拿不到值。`toJsonValue`（query/tree.ts:21-37）把 Date 序列化为 `{}`。
- 文档：docs/api.mdx:50、77-78、90、93-95、414（ja/zh 对应）。

### #19
- `packages/core/src/bundle-check.ts:55-59` `describeBundle(undefined)` 固定文案；调用于 session.ts:329-336（debug log），`conn.info.bundle` 来自 hello。
- `bundle` 由 `withQuiesco` → `writeBuildConfig`（agent/metro.cjs:77-90、116-121）写，仅在 `EXPO_PUBLIC_QUIESCO=1` 时。
- CLI `dev-server.ts`：`metroRunning`（26-29）；`ensureDevServer`（42-74）复用时打印 `using the Metro dev server`，返回 `NOTHING`，**不记录是否复用**，也不检查 metro.config.js。只有 doctor（98-109）/ init（291-304）grep `withQuiesco`。调用于 commands/test.ts:106。

### #20
- doctor `rootCheck`（doctor.ts:134-139）`includes('QuiescoRoot')` ⇒ warn；扫描文件硬编码在 260 行（`app/_layout.tsx`、`src/app/_layout.tsx`、`App.tsx`、`App.js`、`src/App.tsx`、`app/_layout.js`、`src/app/_layout.js`），**不含 main entry 本身**（文案却说含）。
- init entry（init.ts:306-334）：只在 entry 前插 `import '@quiesco/agent'`；不识别 `registerRootComponent(App)`，不包裹 QuiescoRoot；只打印 Next 步骤（375）。

### #21
- init 生成 `features/support/quiesco.ts`（init.ts:174-177、349）、`cucumber.mjs`、`features/package.json`、app.feature、app.steps.ts；**不生成 / 不修改 tsconfig**。
- driver 模式文档：docs/driver-pattern.mdx:52-64（ja/zh 52-56）；README.md:20、177；packages/cucumber/README.md:17-26；world.ts:14-16 docstring。

### #22
- `packages/cucumber/src/world.ts:18-31` 只有 `app`、`session`。Session（core/session.ts:128-135）公开 `provider` ⇒ `session.provider.platform`。Lifecycle 的 `platform` 是 private。
- `QUIESCO_PLATFORM`：config.ts:283-286 读取；CLI test/ui 设置；api.mdx:564、656、672、cli.mdx:59 已提到。
- Driver（core/driver.ts:84-117）无公开 platform（内部用 `options.provider.platform`）。Jest：`globalThis.quiesco { app, session }`（jest/src/index.ts:19-26）；Vitest fixtures `quiesco`、`session`、`app`（vitest/src/index.ts:65-109）。

### #23
- `packages/native/package.json:51-53` `peerDependencies: { "expo-modules-core": "*" }`；native/src/index.ts:8 从 expo-modules-core 导入 `requireOptionalNativeModule`。agent 用 `try { require('@quiesco/native') }` 可选加载。

### 测试文件
- cli：test/init.test.ts、doctor.test.ts、dev-server.test.ts、test-command.test.ts
- agent：test/values.test.ts、native.test.ts、actions-js.test.ts、metro.test.ts
- core：test/bundle-check.test.ts、lifecycle.test.ts

## J.A 发现

### #17 的真实原因（很可能）：pnpm 12 内置 `minimumReleaseAge`
- pnpm 12.14 CHANGELOG：内置默认 1440 分钟、**非 strict**；「`minimumReleaseAge` 挡住 `latest` 指向的版本时，回退到更旧版本」（#16388）；显式配置 `minimumReleaseAge` 时 `minimumReleaseAgeStrict` 默认 true（#14409）。
- 用户运行 init 时 0.3.0 发布约 1 小时、0.2.0 也不满 24h ⇒ 不带版本的 `pnpm add quiesco` 解析 `latest` 时回退到 0.1.1。与 issue 现象吻合；issue 作者猜的「缓存旧元数据」不必要。
- 确切版本 `quiesco@0.3.0`：非 strict 下照装，并写入 `minimumReleaseAgeExclude`（issue 里也观察到）。⇒ 按 CLI 版本安装可以根治。
- 实测（scratchpad）：`pnpm add is-number@7.0.0` 写入 `"7.0.0"`（确切）；`npm install is-number@7.0.0` 写入 `"^7.0.0"`。安装后改写 package.json 会使 lockfile 与 specifier 不一致，故保持包管理器自身写法（与 D1「照常写 ^」略有出入：pnpm 下为确切版本）。

### #23
- Expo 官方做法：模块从 `expo` 导入（expo 再导出 `requireOptionalNativeModule`，见 node_modules/expo/build/Expo.d.ts；Expo 的模块模板 CHANGELOG：从 `expo` 而非 `expo-modules-core` 导入，独立模块才能在 Expo App 外构建）。
- 改动：`packages/native/src/index.ts` 改为 `from 'expo'`；peer `expo: *`；devDependency `expo ~58.0.23`（monorepo 里类型检查用）。monorepo `nodeLinker: hoisted`，lockfile 变化只是去重；react 仍只有一份。
