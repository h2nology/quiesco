# Task Plan: Quiesco npm 首发（0.1.0）

## Goal
把 monorepo 的 11 个包（CLI `quiesco` + `@quiesco/{agent,core,cucumber,expo-plugin,jest,native,protocol,steps,vitest,web}`）整理成可发布状态：用 tarball 装进全新 Expo 项目，按 README 快速开始能在 Web / Android / iOS 跑通第一个场景。真正的 `npm login`、创建 `quiesco` org、`pnpm -r publish` 由 HU 自己做。

## Next Step
计划已出，HU 已答决定项（2026-11-14），待 HU 确认后开始批次 R.A。

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
- [ ] 11 个包版本改为 `0.1.0`
- [ ] 每个包：`publishConfig.access: public`、`repository`（含 `directory`）/ `homepage` / `bugs`（github.com/h2nology/quiesco）、`author: "h2nology"`、`engines.node >=24`、`keywords`
- [ ] 核对 peerDependencies 下限（见 findings「各包现状」）
- [ ] 每个包写简短 README（用途、安装、指向主文档）
- [ ] 收紧 `files`：去掉 `ios-runner/gen.rb` 等开发用文件；tarball 不含测试、绝对路径、tsbuildinfo
- [ ] 根 `release:check` 脚本：`pnpm check` + 各包 `pnpm pack` 内容检查 + 版本一致 + `workspace:` 依赖可被替换
- **Status:** pending

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

## 待 HU 决定
- （R.B 中如出现）agent / native 是否改为发布 dist。

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
