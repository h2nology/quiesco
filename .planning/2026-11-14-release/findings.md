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
