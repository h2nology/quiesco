# Task Plan: 处理 GitHub issues #17–#23（0.3.0 之后）

## Goal
解决 h2nology/quiesco 的 7 个 open issue（同一位用户在 Expo SDK 58 默认模板 + cucumber 项目上的实测反馈）。每个修复都附测试和三语文档，实跑验收后回复并关闭 issue，最后与 #16 的 Jest 列表排序修复一起发下一个版本。

## Current Phase
J.A 完成，待提交 / PR

## Next Step
HU 确认后提交 J.A 并开 PR，然后开始 J.B（#20 init 自动包裹 `<QuiescoRoot>`）。

## 背景
- 前置：0.3.0 已发布；#16（Jest 列表排序）已合并、未发布（`.planning/2026-11-15-progress-and-ui/`）。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md`「工作约定」：先出计划再写代码；测试与 step 禁止 sleep；宣称完成前实跑验收；待确认事项问 HU；用户个人信息不写进包、不发给外部服务。
- issue 摘要与代码定位见 findings.md。

## Issue 一览与分组

| # | 类型 | 标题（简） | 阶段 |
|---|------|-----------|------|
| 23 | bug | native 的必需 peer `expo-modules-core` 让 expo-doctor 两头失败 | J.A |
| 17 | bug | init 安装不带版本的包 → 项目落到旧版本 | J.A |
| 20 | enh | 缺 `<QuiescoRoot>` 静默破坏软重置：init 自动加、doctor 报错 | J.B |
| 21 | docs/enh | step 文件走 Node type stripping：文档 + init 配 tsconfig | J.B |
| 19 | bug | 复用的 Metro 误报「no withQuiesco()」 | J.C |
| 22 | enh | 暴露当前平台 `this.platform` | J.C |
| 18 | bug | date/time picker 的 setValue 替换整个 Date | J.D |

分组依据：J.A 是安装 / 依赖（init + 包元数据），J.B 是 init / doctor 的项目脚手架，J.C 是 core / 适配器的小 API 与诊断，J.D 是 agent 的取值逻辑。J.A 和 J.B 都改 `init.ts` / `doctor.ts`，按顺序做以免冲突。

## 待决定事项（2026-11-15：D1、D2、D3、D7 由 HU 选择推荐项；D4、D5、D6 按推荐默认执行，HU 可随时改）
| ID | 问题 | 推荐 |
|----|------|------|
| D1 | #17 版本怎么写进 package.json | 安装 `<name>@<CLI 版本>`，包管理器照常写 `^x.y.z`；装完读回已安装版本，不一致 ⇒ init 失败（非 0 退出、说明原因和修复命令） |
| D2 | #20 doctor 级别 | 缺 `<QuiescoRoot>` ⇒ error（失败），除非 `quiesco.config` 的重置方式不依赖 remount（如硬重置）；文案明说「软重置不会重置 App 状态」 |
| D3 | #18 time / date 的取值 | `mode="time"` 合并时、分（秒归 0），`mode="date"` 合并年月日、保留时间；另外接受字符串 `"20:15"`（time）和 `"2031-12-24"`（date）；`expectValue` 对 picker 支持 Date（按 picker 的 mode 比较对应部分，本地时间） |
| D4 | #21 tsconfig 放哪 | 改项目根 `tsconfig.json` 加 `allowImportingTsExtensions: true`（Expo 模板默认 `noEmit`，根 `tsc --noEmit` 也会检查 features/，单独的 `features/tsconfig.json` 管不到）；doctor 的 `--dry-run` 检查不做（慢、需要 runner），只在文档里推荐 |
| D5 | #19 是否加「拒绝 / 重启复用的 Metro」选项 | 先只修文案：CLI 记录「复用了外部 Metro」并传给 session，bundle 身份未知时按真实原因提示；不加新选项 |
| D6 | #23 peer 依赖改法 | peer 改为 `expo`（`*`），去掉 `expo-modules-core`；代码改为从 `expo` 导入（Expo 推荐做法；J.A 实施） |
| D7 | 版本号 | #22 新增 API ⇒ 0.4.0（含 #16）；所有阶段完成、三端验收后一起发 |

## Phases

### J.0 调研与计划
- [x] 读 7 个 issue，写 findings
- [x] 代码定位（init / doctor / value / bundle-check / world / native package.json）
- [x] HU 确认 D1、D2、D3、D7（均为推荐项）
- **Status:** complete

### J.A 安装与依赖（#23、#17）
- [x] #23 `@quiesco/native` 改为从 `expo` 导入 `requireOptionalNativeModule`；peer `expo: *`；devDependency `expo ~58.0.23`（monorepo 类型检查）
- [x] #23 实测（pnpm 默认 isolated 的新 blank-typescript 项目）：已发布 0.3.0 ⇒ expo-doctor 19/20（Missing peer expo-modules-core，与 issue 相同）；本分支 tarball ⇒ 20/20；`EXPO_PUBLIC_QUIESCO=1 expo export --platform ios` 成功，`expo` 经 peer 链到 native 旁边，bundle 含 native 模块
- [x] #17 根因复现：现在 bare `pnpm add -D quiesco` 装 0.1.0（0.1.1/0.2.0/0.3.0 都不满 24h，被 pnpm 内置 minimumReleaseAge 挡掉，见 findings）
- [x] #17 init：Quiesco 包装 `@<CLI 版本>`（`@cucumber/cucumber`、`playwright` 不 pin）；tarball 模式期望版本取自文件名；装完从 node_modules 读回版本，不一致 ⇒ 列出差异 + 重装命令，exit 1，不写其他文件
- [x] #17 `CliContext.version`（cli `-v` 也用它）；新模块 `packages/cli/src/packages.ts`（`CLI_COMMANDS`、`installedVersion`、`scriptCommands`）
- [x] #17 doctor：「Quiesco versions」（未安装 / 版本不一 ⇒ fail；与 doctor 自身版本不同 ⇒ warn）；「scripts」（`quiesco <cmd>` 不存在 ⇒ fail）
- [x] #17 实测：本分支 CLI（0.3.0）在新项目上真实从 npm 安装 ⇒ 全部 0.3.0，`minimumReleaseAgeExclude` 自动写入；doctor「6 packages at 0.3.0」
- [x] 文档 en/zh/ja：cli.mdx（init 第 1 步、doctor 检查项）；troubleshooting.mdx 新节 `#quiesco-versions`（版本需一致、`^0.x`、pnpm minimumReleaseAge）
- [x] 测试：init.test（版本 spec、读回失败）、doctor.test（版本 / 脚本检查）、新 packages.test（CLI_COMMANDS 与 HELP / 分发一致、scriptCommands、installedVersion）；fake-context 模拟安装写 node_modules
- [x] `pnpm check` 828 通过（exit 0）；`docs:check --no-mint` 通过
- 备注：pnpm 对确切版本写入 `"0.3.0"`（不带 ^），npm 写 `^0.3.0`；保持包管理器写法（安装后改写会让 lockfile 不一致）
- 未做：doctor 由更新的 CLI 运行于旧项目时，scripts 检查按 doctor 自身命令表判断（版本 warn 已提示）
- **Status:** complete（2026-11-15；分支 `fix/install-versions`，未提交）

### J.B 项目脚手架（#20、#21）
- [ ] #20 init：entry 为 `registerRootComponent(App)` 且 `App` 是本地导入时，自动改成包裹 `<QuiescoRoot>`（或生成包裹组件）；识别不了时保留现有手动提示
- [ ] #20 doctor：扫描文件加入 main entry 及其导入的根组件文件（含 `.jsx`）；按 D2 改级别和文案
- [ ] #21 init：按 D4 改 tsconfig（已有则合并字段，不覆盖其他配置；无 tsconfig 时跳过并提示）
- [ ] #21 生成的 `features/support/quiesco.ts` 加注释（type stripping：相对导入写 `.ts`；不支持 enum / 参数属性 / namespace）；driver-pattern 文档、README、world.ts docstring 加说明，示例改成不用参数属性
- [ ] 测试：init.test（默认 Expo 模板 fixture）、doctor.test；三语文档
- [ ] 实测：`create-expo-app` 默认模板 + `quiesco init`（tarball）⇒ doctor 全过、`tsc --noEmit` 通过、两个场景间状态被重置
- **Status:** pending

### J.C 诊断与 API（#19、#22）
- [ ] #19 `ensureDevServer` 返回是否复用；session 拿到这个信息；bundle 身份未知时：复用外部 Metro ⇒「<url> 的 Metro 不是 Quiesco 启动的，配置未知，请重启或停掉它」；否则保留原 metro.config.js 提示（可再用 init 的 `withQuiesco` 检测区分）
- [ ] #22 `Session.platform`（公开只读）；`QuiescoWorld.platform`；`Driver.platform`；Vitest / Jest 通过 `app.platform` / `session.platform` 自然可用；类型 `'ios' | 'android' | 'web'`
- [ ] #22 文档：driver-pattern（分平台分支示例）、api.mdx；`QUIESCO_PLATFORM` 写明是 CLI 设置的环境变量
- [ ] 测试：bundle-check.test、dev-server.test、lifecycle / world 测试
- **Status:** pending

### J.D 日期时间 picker（#18）
- [ ] agent `case 'date'` 读 `mode`：按 D3 合并到当前 `value`；`datetime` / `countdown` 不变；min/max 检查用合并后的值
- [ ] protocol / driver：接受 time / date 字符串（按 D3）；类型更新
- [ ] `expectValue` 对 date picker：semantic 层给出 Date 值，按 mode 比较；文档写明返回 / 比较规则（本地时间）
- [ ] 示例 App：加一个 date + time 两步选择的场景（Android 两个对话框，iOS inline）作为回归
- [ ] 测试：values.test；三语 api.mdx
- [ ] 实测：示例场景 web / iOS / Android 全过
- **Status:** pending

### J.E 集成验收与发布
- [ ] 集成分支上示例 App 全套 web / iOS / Android（长跑用 caffeinate）
- [ ] `pnpm check`、`docs:check`、`check:prod-strip`（J.A 改了 native 包）
- [ ] PR 合并；按 docs/releasing.md 发 0.4.0（D7）；逐个回复并关闭 #17–#23
- **Status:** pending

## Decisions Made
| 决定 | 选择 | 理由 |
|------|------|------|
| 计划位置 | `.planning/2026-11-15-issues-17-23/` | 与前几次 issue 批次一致 |
| D1 #17 版本 | 安装 `@<CLI 版本>`（写 `^x.y.z`），读回不一致 ⇒ init 失败 | HU 选择 |
| D2 #20 doctor | 缺 QuiescoRoot ⇒ error；硬重置时除外 | HU 选择 |
| D3 #18 picker | 按 mode 合并 + 接受 `"HH:mm"` / `"YYYY-MM-DD"` + expectValue 支持 Date | HU 选择 |
| D7 版本 | 0.4.0，全部完成并三端验收后发布 | HU 选择 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| 文档编辑脚本里的条件替换误删了 zh/troubleshooting.mdx 的 `## 仍然无法解决` 标题 | 1 | git checkout 恢复该文件后重新编辑；之后的替换都用 assert count==1 |
