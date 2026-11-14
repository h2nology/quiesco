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
