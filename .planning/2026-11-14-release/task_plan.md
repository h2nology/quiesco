# Task Plan: Quiesco npm 首发（0.1.0）

## Goal
把 monorepo 的 11 个包（CLI `quiesco` + `@quiesco/{agent,core,cucumber,expo-plugin,jest,native,protocol,steps,vitest,web}`）整理成可发布状态：用 tarball 装进全新 Expo 项目，按 README 快速开始能在 Web / Android / iOS 跑通第一个场景。真正的 `npm login`、创建 `quiesco` org、`pnpm -r publish` 由 HU 自己做。

## Next Step
R.A 完成并提交（2026-11-14，`pnpm release:check` 通过）；R.D 计划 HU 已答决定项。R.B tarball 冒烟三端通过（2026-11-14）。两处易用性问题已修并复测，已提交（774a02b）。R.C 完成并提交（2343100）。R.D.0 调研完成；R.D.1 + R.D.2 已提交（c2f93ee）。R.D.3 已提交（0e630fd）。R.D.4 已提交（a6a1f25）。R.D.5 完成（未提交）。R.D.6：HU 已上线站点，README 链接改指站点（未提交）。下一步：HU npm 首发（docs/releasing.md）。

## 背景
- 前置：Quiesco Phase 6 完成（`.planning/2026-11-07-quiesco/`，2026-11-14 验收）；6.13 真机、6.14 LLM 驱动暂缓。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md`「工作约定」：先出计划再写代码、测试与 step 禁止 sleep、宣称完成前实跑验收、待确认事项问 HU；用户个人信息（姓名、邮箱）不写进包、不发给外部服务。

## HU 决定（2026-11-14）
- 版本：11 个包统一 `0.1.0`。
- author：组织名 `h2nology`（不写个人姓名 / 邮箱）。
- 冒烟测试：Web / Android / iOS 三端都跑。
- `npm login`、建 `quiesco` org、正式 publish：HU 自己做。

## Phases

### R.A 包配置
- [x] 11 个包版本改为 `0.1.0`（`AGENT_VERSION` 同步）
- [x] 每个包：`publishConfig.access: public`、`repository`（含 `directory`）/ `homepage` / `bugs`（github.com/h2nology/quiesco）、`author: "h2nology"`、`engines.node >=24`、`keywords`
- [x] 核对 peerDependencies 下限：保持不变（见 findings「peerDependencies 结论」）
- [x] 每个包写简短 README（10 个新写；steps 已有，相对链接改为 GitHub 绝对链接）
- [x] 收紧 `files`：core 去掉 `ios-runner/gen.rb`；jest / vitest 加上 `src`（source map 指向的源码原来不在包里）
- [x] `scripts/check-release.mjs` + 根 `release:check`（= `pnpm check` + 打包检查：版本一致、无 `workspace:`、元数据、入口文件存在、无测试 / tsconfig / tsbuildinfo / .rb、source map 的源码在包内、无本机绝对路径）；反向验证：放回 gen.rb + 删 publishConfig ⇒ 报 2 个问题
- **Status:** complete（2026-11-14）

### R.B tarball 冒烟（验收）
- [x] 11 个 tarball 装进全新 create-expo-app（expo 58.0.25 / RN 0.88.1 / React 19.3.0，scratchpad `rb/smoke`）
- [x] 按 README 快速开始执行 `quiesco init --packages`（发布前 npx 无法从 registry 解析依赖，用仓库 CLI 跑 init，之后都用项目内从 tarball 装的 `quiesco`）/ `quiesco doctor`（Quiesco 检查全过）
- [x] 第一个场景三端通过：Web 1/1（4.2s）、iOS 1/1（iPhone 17 / iOS 27.0，native module true，48s 含启动）、Android 1/1（API 37，native module true，40s 含启动）；agent 报告 0.1.0
- [x] 用户项目 `tsc --noEmit`：3 个错误，未装 Quiesco 的纯模板同样 3 个（模板自身的 CSS 模块声明、app-tabs.web ref 类型）⇒ Quiesco 不新增错误
- [x] 生产剔除：Web 生产导出 agent 标记 0 处（e2e 导出对照组有）；原生生产 prebuild：Podfile `use_expo_modules!(exclude: ['@quiesco/native'])`、settings.gradle `expoAutolinking.exclude`、Podfile.lock 无 QuiescoNative（e2e 有）
- [x] agent / native 的 TS 源码入口：Metro 编译和用户 tsc 都没问题 ⇒ 不改为发布 dist
- [x] 易用性修复（HU 2026-11-14：两处都修）：① init 生成的配置加注释掉的 `devices` 示例（按所选平台）；② `Session.dispose` 先结束被测 App 再停 server（iOS App 不再连回下一轮）；单元测试 +1、docs/api.md 补一句；pnpm check 676 通过；重新打包后冒烟 iOS → Android → Web 全过，iOS 跑完模拟器上 App 已退出，无 `Unknown session` 警告
- **Status:** complete（2026-11-14）

### R.C 文档
- [x] `docs/releasing.md`：首发前提（npm 2FA、建 `quiesco` org、名字未被占用）、每次发布步骤（改版本含 AGENT_VERSION → release:check → 可选 tarball 冒烟 → `pnpm -r publish --dry-run` / `publish` → 打 tag → 从 npm 验证）、补救（部分发布重跑；72 小时内按依赖逆序 unpublish、版本号不可复用；之后 deprecate 全部包；dist-tag 改回）
- [x] 根 README：「Using Quiesco from source」改为「Using unreleased changes」（快速开始本来就是 `npx quiesco init`，发布后直接可用），链到 releasing
- [x] 暂不引入 Changesets（写进 releasing「Not set up」）
- [x] `release:check` 加检查 `AGENT_VERSION` 与包版本一致（反向验证能报错）；`pnpm release:check` 通过
- **Status:** complete（2026-11-14）

### R.D 文档站（Mintlify，多语言；HU 2026-11-14 要求）
**HU 决定（2026-11-14）**：English 为源 + 简体中文（`zh`）+ 日本語（`ja`）；在 npm 首发之前做（R.B 之后），0.1.0 的包 README 直接链到站点；源文件方式：仓库里放 `docs.json`，Mintlify 连 GitHub 仓库按它生成站点（见下）。

**做法**：`docs/` 直接改成 Mintlify 项目（`docs/docs.json`；英文页在 `docs/` 根，`docs/zh/`、`docs/ja/` 同名文件；Mintlify 后台开「docs.json is in a subdirectory」填 `/docs`）。只有一份源；`docs/spikes/` 移出 `docs/`（如 `research/spikes/`）以免被当成站点页面。API 页手写（Quiesco 是 TS 库，Mintlify 的自动 API 页面基于 OpenAPI，不适用）。

范围：根 README 的介绍和快速开始、`docs/` 下 api / sync / platforms / driver-pattern / parallel / cli / troubleshooting / known-issues / benchmarks / detox-comparison、steps 的步骤表、示例 App 说明（英文约 2,000 行）。requirements.md、`.planning/` 不上站。
- [x] R.D.0 调研（2026-11-14）：结论见 findings「R.D.0 调研」（.md / .mdx 都可、相对链接、Mintlify 锚点规则、.mintignore、缺翻译 404、mint CLI 4.3.34 实测）
**HU 决定（2026-11-14，R.D.0 之后）**：全部改成 `.mdx`；`docs:check` 单独脚本 + 单独 CI job（不进 `pnpm check`）；外观先用占位（theme `mint`、主色 `#2563eb`、文字 logo）。

**页面（每种语言 16 页，英文在 `docs/` 根，`docs/zh/`、`docs/ja/` 同名）：**
- 入门：`index`（介绍，来自 README）、`quickstart`（Web，Steps 组件）、`native`（iOS / Android）、`runners`（Jest / Vitest）
- 指南：`sync`、`platforms`、`driver-pattern`、`parallel`、`troubleshooting`、`known-issues`
- 参考：`api`、`cli`、`steps`（来自 packages/steps/README）、`example-app`（来自 examples/todo-app/README）
- 其他：`benchmarks`、`detox-comparison`
- 不上站（`docs/.mintignore`）：`spikes/`、`releasing.md`（维护者文档，保持 .md、不翻译）

- [x] R.D.1 骨架（2026-11-14；zh / ja 的导航在 R.D.3 加，文件没有时 validate 会报错）：`docs/docs.json`（`$schema`、name、theme mint、colors.primary #2563eb、文字 logo、navbar GitHub / npm 链接、`navigation.languages` en / zh / ja，分组标签各自翻译）；`docs/.mintignore`
- [x] R.D.2 英文迁移（2026-11-14；没有现成的「Note:」段落，只有 steps 页的引用块改成 `<Warning>`；所有 `##` 标题都加了固定 id，被链接的 `###` 也加，id 沿用 GitHub 的写法以免旧链接失效）：`git mv docs/*.md → .mdx`（releasing 除外）；frontmatter `title` / `description`，去掉正文 H1；正文的 `{` `<` 转义；明显的「Note:」段落改用 `<Note>` / `<Warning>`；内容不改写。链接：站内用不带扩展名的相对路径（`./api#…`，翻译文件不用改）；被链接的标题加固定 `{#英文-id}`，三种语言一致（中日文标题会生成不同的锚点）；指向 docs 外（README、examples、packages、spikes）的改成 GitHub 绝对地址。新写 index / quickstart / native / runners / steps / example-app（内容取自现有 README）。仓库里所有指向 `docs/*.md` 的路径（代码注释、各包 README、根 README）改成 `.mdx`，重新 build
- [x] R.D.3 翻译 zh / ja（2026-11-14，4 个子代理并行，统一术语和软换行后复查；未提交）：代码、API 名、配置键、错误码、命令输出不翻；代码里的注释翻；Gherkin 示例不翻（和旁边的 step 定义是成对的代码；steps 页的步骤表本来就有中日文列）；术语表写进 findings，全站一致
- [x] R.D.4（2026-11-14，未提交；反向验证：删一页译文、改一个标题 id、改一个链接 ⇒ 报 6 个问题）`scripts/check-docs.mjs` + 根 `docs:check`：`pnpm dlx mint@4.3.34 validate`、`broken-links --check-anchors`；自写检查：三种语言页面集合一致、docs.json 里的页面都存在、每个 .mdx 都在导航里；`.github/workflows/docs.yml`（docs/** 变更时跑）
- [x] R.D.5（2026-11-14，未提交；README 的开发说明链到 CONTRIBUTING）维护规则：根 `CONTRIBUTING.md`：英文是源，改英文页的同一个 PR 同时改 zh / ja；README 与 index / quickstart 内容重叠，改一处要同步
- [x] R.D.6（2026-11-14）HU 已上线 https://shift-14cc7601.mintlify.site（从 main 部署）；根 README（文档段改指站点 + 中日文入口）、9 个包 README、示例 README、CONTRIBUTING 的文档链接改指站点，逐个请求 200、锚点都在。原计划：上线（HU 做，二选一）：a) Mintlify 后台建项目、装 GitHub App、设子目录 `/docs`；b) `mint deploy --github --subdomain <name> --directory docs` 生成 `.github/workflows/mintlify.yml`，再 `mint claim`（未认领 24 小时后删除）；域名用 `mint add-domain`；后台「Language routing」选是否按浏览器语言跳转；之后根 README / 各包 README 的文档链接改指站点
- **验收：** `mint dev` 本地预览，三种语言 48 页逐一请求都正常渲染（并截几页给 HU 看）；`docs:check` 通过；`pnpm check` 通过（改了代码注释路径）；HU 抽查译文
- **Status:** complete（2026-11-14；HU 抽查译文待进行）

## 待 HU 决定

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
