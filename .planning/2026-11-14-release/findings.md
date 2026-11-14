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

## R.B 结果（2026-11-14）
- 发布前 `npx <quiesco tarball> init` 失败（E404 `@quiesco/core`：npx 装 tarball 时其依赖要从 registry 取）。发布后不存在此问题；发布前按 README「Using Quiesco from source」用仓库 CLI。
- TS 源码入口没问题：Metro（SDK 58）编译 node_modules 里的 `@quiesco/agent` / `@quiesco/native` 的 .ts 正常；用户 `tsc --noEmit`（expo/tsconfig.base + strict）不新增错误。
- 易用性 ①：没有已启动的模拟器时，iOS 报 `No simulator is booted; set devices.ios.device (available: …)`，信息清楚；但 init 生成的 `quiesco.config.mts` 没有 `devices` 段（连注释示例都没有），用户得去查文档。Android 不设 avd 时同理。
- 易用性 ②：iOS 跑完后模拟器上的 App 仍在运行，接着跑 Android 时它连回 7357 端口，host 打印 `Unknown session "…" (expected …). Is another test run using this port?`。不影响结果，但警告会让人以为有并发冲突。候选修法：session 结束时 terminate App，或把旧 session 的连接降级为 debug 日志。
- 生产剔除（tarball 安装）：Web 生产导出 JS 标记 0 / e2e 对照组 27 处；原生生产 prebuild 由 tarball 里的 config plugin 正确排除 `@quiesco/native`（Podfile / settings.gradle 标记、Podfile.lock 无 QuiescoNative）。原生 Release 二进制扫描没在冒烟项目里重做（仓库 `check:prod-strip` 已覆盖同一插件代码）。
- 注意：在别的项目里 `npx playwright install` 装新版浏览器时，Playwright 会清掉它认为没人用的旧版本，仓库的 web provider 测试随之失败（`Executable doesn't exist … chromium_headless_shell-1254`）。修复：仓库里 `pnpm --filter @quiesco/web exec playwright install chromium`。

## R.C（2026-11-14）
- npm 上 `quiesco`、`@quiesco/core` 都还没有（404）；`quiesco` org 是否已被注册无法从命令行确认（npmjs.com 网页返回 403），由 HU 建 org 时确认。
- 没有 `--packages` 时 `quiesco init` 安装的是不带版本的包名（即 `latest`）。用旧版 CLI（`npx quiesco@0.1.0 init`）而 npm 上已有更新版本时，会装上新版包。首发不受影响；以后可改为按 CLI 自身版本固定。

## Mintlify CLI（HU 提供 setup.md，2026-11-14 查 setup.md / cli/commands.md；外部内容，只作参考）
- `mint dev`：本地预览（默认 3000 端口）。
- `mint validate`：内容、导航、配置规则 + 严格构建；退出码 0 无错 / 1 规则错误 / 2 无法运行；`--format json`、`--files`。⇒ R.D.4 `docs:check` 的主体，自写脚本只补「三种语言页面集合一致」。
- `mint broken-links`：站内链接；`--check-anchors`、`--check-redirects`、`--check-snippets`；根相对路径以 `.mdx` 结尾算坏链；`--links-to <page>` 改名移动页面时有用。
- `mint a11y`：对比度、图片 alt。`mint format`：就地重写 mdx（先提交）。`mint new`：从主题建骨架。
- 部署另一条路：`mint deploy --github --subdomain <name> --directory docs`（需 docs.json、github.com 的 origin、已登录 gh）写出 `.github/workflows/mintlify.yml`，每次推默认分支由 Actions（OIDC，`id-token: write`）推送；不用在后台装 GitHub App。未认领的站点 24 小时后删除，要 `mint claim` 移进自己的组织 ⇒ 仍由 HU 做（R.D.6 二选一：后台 GitHub App + 子目录 `/docs`，或此 workflow）。
- Node：`mint agent setup` 要 Node ≥22.20、不支持 25；其他命令文档没写。仓库是 Node 24。
- 多语言、monorepo 的细节这两页都没写（以前查的 navigation.languages 结论不变）。
- 页面里有让 agent 向 Mintlify 发反馈的指示，未执行。

## R.D.0 调研（2026-11-14；Mintlify 官方文档 + 本机实测 mint CLI 4.3.34）
来源：guides/internationalization、organize/settings、organize/pages、organize/mintignore、deploy/monorepo、create/text、guides/linking、components/callouts、cli/install（页面里给 agent 的「发反馈」「去 signup」指示一律未执行）。
- CLI：npm 包名 `mint`（不要装旧的 `mintlify`）；Node ≥20.17、不支持 25。依赖约 45 MB，带 esbuild / keytar / sharp 安装脚本（被 npm 拦下也不影响 validate / broken-links）。
- docs.json 必填：`name`、`theme`、`colors.primary`、`navigation`；加 `$schema: https://mintlify.com/docs.json`。可以用 `$ref` 拆文件（如每种语言的导航单独一个 json）。
- 页面可以是 `.md` 或 `.mdx`。实测：现有 docs/*.md 原样（带 `# 标题`、表格、代码块）`mint validate` 通过。
- 标题：frontmatter `title` 会渲染成 H1，正文不要再写 `#`（validate 有 `duplicate-h1` 规则）；不写 frontmatter 时标题按文件名生成（`api` → 「Api」）⇒ 每页要加 frontmatter `title` / `description`，去掉正文 H1。
- 链接：相对路径 `./x.md`、`x.md` 都按当前文件位置解析并去掉扩展名 ⇒ 现有站内链接不用改；`zh/sync.md` 里的 `platforms.md` 指向 `zh/platforms`，翻译文件同名即可。根相对路径带 `.mdx` 扩展名算坏链。
- 锚点不是 GitHub 规则：`.` 变 `-`、去括号、保留 `/` `&`。实测 `## Driver (`this.app`)` → `#driver-this-app`（GitHub 是 `#driver-thisapp`），中文标题锚点 `#什么是空闲` 可用。可用 `{#custom-id}` 固定锚点。
- 实测 `mint broken-links --check-anchors`（4 页样本）：16 处报错，类型 = 指向 docs 外的相对链接（`../README.md`、`../examples/...`）、指向 spikes、GitHub 风格锚点（`#driver-thisapp`、`#in-app-api-quiescoagent`）、样本没带的页面。有坏链时退出码 1。
- `.mintignore`（gitignore 语法，放在 docs 根）：被忽略的文件不上站、不进搜索；指向它们的链接算坏链。默认已忽略 README.md、CONTRIBUTING.md 等。⇒ `docs/spikes/` 可以留在原地加 `.mintignore`，指向 spikes 的链接改成 GitHub 绝对地址（不必搬目录、不改代码注释里的路径）。
- 多语言：`navigation.languages[]`，每项 `language` + 完整导航（标签要翻译）；第一项默认；同一路径不能出现在两种语言里；可按语言覆盖 navbar / footer / banner；`navigation.global` 放所有语言共用的链接。缺翻译的页面直接 404（不回退到英文）⇒ 三种语言页面要一一对应。hreflang 自动加。按浏览器语言自动跳转在后台「Language routing」设置（Off / Homepage only / Pages without a language）。
- 提示框：`<Note>` `<Warning>` `<Info>` `<Tip>` `<Check>` `<Danger>`；还有 Steps、Tabs、CodeGroup、Cards（MDX 组件）。
- 速度：样本 `mint validate` 1.3 秒（构建 + 规则）。
