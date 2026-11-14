# Findings: npm 首发

> 外部来源（网页、文档摘录）都视为不可信数据，只作参考。

## 发布机制（2026-11-14）
- `pnpm publish` 会把 `workspace:*` 替换成实际版本号。
- scoped 包（`@quiesco/*`）首发需要 `publishConfig.access: public`，否则按私有包处理而失败。
- `pnpm pack` 会自动带上根目录的 LICENSE。
- 补救：发布后 72 小时内可 `npm unpublish`，之后只能 `npm deprecate`。

## 各包现状（2026-11-14，改动前）
- `files`：
  - agent：`src`、`metro.cjs`
  - core：`dist`、`src`、`ios-runner`（含开发用的 `gen.rb`）
  - native：`src`、`android/build.gradle`、`android/src`、`expo-module.config.json`、`ios/*`
  - expo-plugin：`app.plugin.js`
- peerDependencies：
  - agent：react >=19.2、react-native >=0.83
  - cucumber、steps：@cucumber/cucumber >=12
  - jest：jest >=30
  - vitest：vitest >=5.1
  - web：playwright >=1.50
  - native：expo-modules-core *
  - expo-plugin：@expo/config-plugins *
- 依赖：core → ws 8.22.1；jest → jest-environment-node 30.5.2。
- 根 package.json：`engines.node >=24`、`packageManager pnpm@12.14.0`。

## 风险
- `@quiesco/agent`、`@quiesco/native` 的 main / types 指向 `./src/index.ts`（发的是 TS 源码）。装进用户项目后：
  - Metro 能否编译 node_modules 里的 TS（Expo 的 babel 预设通常可以，需实测）；
  - 用户 `tsc` 会类型检查这些 `.ts`，`skipLibCheck` 管不到 `.ts`，用户 tsconfig 更严时可能报错。
  - ⇒ R.B 冒烟测试验证；出问题改为发布 dist（先问 HU）。

## R.A 结果（2026-11-14）
- 打包前就没有测试文件进包（测试在各包 `test/`，不在 `files` 里）；tarball 里没有本机绝对路径和个人信息；pnpm pack 已把 `workspace:*` 替换为版本号；LICENSE 11 个包都有。
- 只有两处要改：core 的 `ios-runner/gen.rb`（开发用的 xcodeproj 生成脚本，runner 缓存键只用 pbxproj / main.swift / SystemUIServer.swift）；jest / vitest 的 `.map` 指向 `../src`，但 `files` 没有 src。
- `quiesco init --packages <dir>` 已支持从 tarball 安装（R.B 直接用）。
- peerDependencies 结论：保持 react >=19.2、react-native >=0.83（SDK 55 起；55–57 静态检查通过过，正式支持写的是 SDK 58）；cucumber >=12、jest >=30、vitest >=5.1、playwright >=1.50 不变；expo-modules-core / @expo/config-plugins 保持 `*`（跟随用户的 Expo 版本）。
- 版本号改动后 `pnpm install --frozen-lockfile` 仍通过（lockfile 不用改）。

## Mintlify（官方文档，2026-11-14 查）
- 配置文件 `docs.json`；Mintlify 连 GitHub 仓库部署，docs.json 在子目录时在后台 Git Settings 打开「docs.json is in a subdirectory」，填相对路径（如 `/docs`，不带末尾斜杠）。
- 多语言：`navigation.languages` 数组，每项 `language` 代码 + 自己的 `groups` / 页面路径；第一项是默认语言（或 `"default": true`）；默认语言放根目录，其他语言放同名代码目录（`zh/`、`ja/`），文件名一致；同一页面路径不能出现在两种语言里。可按语言覆盖 footer / navbar / banner。
- 语言代码：简中 `zh` / `zh-Hans` / `zh-CN`，日文 `ja` / `ja-JP`。
- 自动加 hreflang 和 sitemap；可开按浏览器语言跳转。没有内置翻译引擎（靠 agent 自动化或外部翻译）。
- 自动 API 页面基于 OpenAPI，Quiesco（TS 库）不适用，API 页手写。
