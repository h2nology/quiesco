# Progress: npm 首发

## 2026-11-14 计划
- HU 问如何发布到 npm ⇒ 出「发布准备」计划（R.A 包配置 / R.B tarball 冒烟 / R.C 文档）
- HU 决定：版本 0.1.0、author `h2nology`、冒烟三端都跑；login / 建 org / publish 由 HU 做
- HU 要求单独立计划 ⇒ 从 `.planning/2026-11-07-quiesco/task_plan.md` 移到本目录

## 2026-11-14 R.A 包配置
- 11 个 package.json：0.1.0、author h2nology、repository / homepage / bugs、engines、publishConfig、keywords；core files 去掉 gen.rb，jest / vitest 加 src；AGENT_VERSION 0.1.0
- 10 个包新 README，steps README 链接改绝对
- scripts/check-release.mjs + `pnpm release:check`：通过（pnpm check 675 + 11 包检查）；反向验证能报错
- HU 要求加文档站 Phase（Mintlify、多语言）⇒ R.D 计划写入 task_plan，待 HU 决定语言 / 源文件位置 / 时机
- HU 答 R.D：en + zh + ja、首发之前做、仓库放 docs.json 让 Mintlify 从 GitHub 生成 ⇒ 查官方文档确认（支持子目录 /docs），R.D 改为 docs/ 直接做 Mintlify 项目

## 2026-11-14 R.B tarball 冒烟
- 提交 R.A（6634be0）；scratchpad rb/：create-expo-app（SDK 58.0.25）+ init --packages + README 快速开始步骤 1–3
- doctor 通过；tsc 与纯模板一致（3 个模板自身错误）；Web 1/1；dev client 构建（Android / iOS，caffeinate）；iOS 1/1、Android 1/1（第一次 iOS 因未设 devices 失败，按报错补上）
- 生产剔除：Web 标记 0；原生 prebuild 排除 @quiesco/native
- 结束后关闭 Metro、模拟器、emulator
- HU：两处易用性问题都修 ⇒ init 配置模板加 devices 注释示例；Session.dispose 先 terminate App；测试 +1（session.test）、device-state 测试期望加 terminate；docs/api.md
- pnpm check 第一次 web provider 22 个测试因缺 chromium_headless_shell-1254 失败：冒烟项目 `npx playwright install`（1.66 / 1255）清掉了仓库 Playwright 1.65 的浏览器 ⇒ 仓库内重装后 676 全过（环境问题，非代码）
- 重新打包复测：iOS 1/1（结束后 App 已退出）→ Android 1/1（无 Unknown session）→ Web 1/1；设备、Metro 已关闭

## 2026-11-14 R.C 文档
- 提交 R.B 修复（774a02b）
- `npm view quiesco` / `@quiesco/core` 均 404（名字未被占用）
- docs/releasing.md；README「Using unreleased changes」；check-release 加 AGENT_VERSION 一致性检查（反向验证报错）；`pnpm release:check` 通过

## 2026-11-14 R.D.0 调研
- 提交 R.C（2343100）
- 读 Mintlify 官方文档（i18n、settings、pages、mintignore、monorepo、链接、锚点、组件、CLI 安装）；scratchpad 装 mint 4.3.34，用现有 4 页 + zh 样本实测 validate（1.3s 通过）、broken-links --check-anchors（16 处，类型见 findings；退出码 1）、中文锚点
- HU 决定：全部 .mdx、docs:check 单独脚本 + CI job、外观占位 ⇒ R.D.1–R.D.6 细化写进 task_plan，待 HU 确认


## 2026-11-14 R.D.1 + R.D.2
- docs.json（en 导航 4 组 16 页、navbar npm / GitHub）、.mintignore（spikes/、releasing.md）
- git mv 10 页 → .mdx；迁移脚本：frontmatter title / description、去 H1、站内链接 `./page#id`、docs 外链接改 GitHub 绝对地址、正文 `<` → `&lt;`；所有 `##` 加固定 id
- 新页：index（CardGroup）、quickstart（Steps）、native、runners、steps（来自 steps README，Warning）、example-app（来自示例 README）
- 仓库 20 个文件里的 docs/*.md 路径改 .mdx（代码注释、README、requirements.md）
- mint validate、broken-links --check-anchors 通过；mint dev：16 页 200，releasing / spikes 404；Playwright 截图检查首页卡片、Steps、Warning、锚点 #driver-thisapp；pnpm check 676 通过
