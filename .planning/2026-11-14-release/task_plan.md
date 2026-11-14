# Task Plan: Quiesco npm 首发（0.1.0）

## Goal
把 monorepo 的 11 个包（CLI `quiesco` + `@quiesco/{agent,core,cucumber,expo-plugin,jest,native,protocol,steps,vitest,web}`）整理成可发布状态：用 tarball 装进全新 Expo 项目，按 README 快速开始能在 Web / Android / iOS 跑通第一个场景。真正的 `npm login`、创建 `quiesco` org、`pnpm -r publish` 由 HU 自己做。

## Next Step
R.A 完成并提交（2026-11-14，`pnpm release:check` 通过）；R.D 计划 HU 已答决定项。进行中：R.B tarball 冒烟。

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
- [ ] 11 个 tarball 装进全新 create-expo-app（SDK 58，放在 scratchpad）
- [ ] 按 README 快速开始执行 `quiesco init` / `quiesco doctor`
- [ ] 第一个场景在 Web / Android / iOS 三端通过（iOS 需 `pod install` + dev client 构建，Android 需 dev client 构建）
- [ ] 用户项目 `tsc --noEmit` 通过
- [ ] 生产构建剔除检查（agent / 原生模块不进生产包）
- [ ] 若 agent / native 的 TS 源码入口出问题 ⇒ 改为发布 dist，**改入口前先问 HU**
- **Status:** pending

### R.C 文档
- [ ] `docs/releasing.md`：前提、步骤、补救（72 小时内 `npm unpublish`，之后 `npm deprecate`）
- [ ] 根 README 安装说明改为从 npm 安装
- [ ] 暂不引入 Changesets
- **Status:** pending

### R.D 文档站（Mintlify，多语言；HU 2026-11-14 要求）
**HU 决定（2026-11-14）**：English 为源 + 简体中文（`zh`）+ 日本語（`ja`）；在 npm 首发之前做（R.B 之后），0.1.0 的包 README 直接链到站点；源文件方式：仓库里放 `docs.json`，Mintlify 连 GitHub 仓库按它生成站点（见下）。

**做法**：`docs/` 直接改成 Mintlify 项目（`docs/docs.json`；英文页在 `docs/` 根，`docs/zh/`、`docs/ja/` 同名文件；Mintlify 后台开「docs.json is in a subdirectory」填 `/docs`）。只有一份源；`docs/spikes/` 移出 `docs/`（如 `research/spikes/`）以免被当成站点页面。API 页手写（Quiesco 是 TS 库，Mintlify 的自动 API 页面基于 OpenAPI，不适用）。

范围：根 README 的介绍和快速开始、`docs/` 下 api / sync / platforms / driver-pattern / parallel / cli / troubleshooting / known-issues / benchmarks / detox-comparison、steps 的步骤表、示例 App 说明（英文约 2,000 行）。requirements.md、`.planning/` 不上站。
- [ ] R.D.0 调研：Mintlify 当前文档细节（MDX 组件、`mint dev` 本地预览、`mint broken-links`、GitHub App 部署、语言自动跳转），结论写进 findings
- [ ] R.D.1 站点骨架：`docs/docs.json`（名称、配色、logo 占位、GitHub / npm 链接、`navigation.languages` en / zh / ja）；结构 = 入门（介绍、快速开始 Web、iOS / Android、其他运行器）/ 指南（同步、平台差异、Driver 模式、并行、故障排查、已知问题）/ 参考（API、CLI、通用 steps、配置）/ 其他（基准、与 Detox 对比）
- [ ] R.D.2 英文迁移：`docs/*.md` → `.mdx`（frontmatter 标题、代码块标语言、提示框用 Mintlify 组件、站内链接改站点路径）；内容不改写；spikes 移走；仓库内引用 docs/*.md 的链接（README、代码注释、各包 README）一并更新
- [ ] R.D.3 翻译 zh / ja：代码、API 名、配置键、错误码不翻；Gherkin 示例用对应 `# language:`；术语表放 findings，全站一致
- [ ] R.D.4 `docs:check`：三种语言页面集合一致、docs.json 导航指向的文件都存在、`mint broken-links` 通过；加进 `pnpm check`
- [ ] R.D.5 维护规则：英文是源；改英文的提交同时更新 zh / ja（或标记待翻译），写进 CONTRIBUTING
- [ ] R.D.6 上线：HU 在 Mintlify 建项目、装 GitHub App、设子目录 `/docs`（和域名）；之后根 README / 各包 README 的文档链接改指站点
- **验收：** `mint dev` 本地预览三种语言所有页面；`docs:check` 通过；HU 抽查译文
- **Status:** 计划已出，HU 已答决定项（2026-11-14），待开始（顺序：R.B → R.C → R.D → HU 发布）

## 待 HU 决定
- （R.B 中如出现）agent / native 是否改为发布 dist。

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
