# Spike 6：生产构建中剔除 agent 与原生模块

- 日期：2026-11-07
- 环境：Expo SDK 58.0.23 / RN 0.88.1 / Metro（`expo export`、`expo prebuild`）、Gradle（R8 开启）、CocoaPods 1.17.0
- 验证代码：
  - JS：`spikes/spike-app/metro.config.js`（方案 B）、`spikes/spike-app/index.ts`（方案 A）、`spikes/spike-app/spike/s6/`
  - 原生：`spikes/spike-app/plugins/with-quiesco-native.js`（config plugin），已登记在 `app.json` 的 `plugins` 中

## 结论

| 对象 | 采用的方案 | 验证结果 |
|---|---|---|
| `@quiesco/agent`（JS） | **Metro resolver 替换**：`withQuiesco(metroConfig)` 在非 e2e 构建时，把 `@quiesco/agent` 解析到桩入口（`QuiescoRoot` 直接返回 children，`quiesco.backdoor` / `onReset` 为空操作） | ✅ Web、iOS、Android 三端的生产产物中都找不到特征字符串 |
| `@quiesco/native`（原生） | **config plugin 在 prebuild 时排除 autolinking**：非 e2e 时向 Podfile 注入 `use_expo_modules!(exclude: [...])`，向 settings.gradle 注入 `expoAutolinking.exclude = [...]` | ✅ 生产模式下 iOS 的 Podfile.lock 和 Android 的 R8 release APK 中都没有该模块；e2e 模式下存在 |
| App 中的测试专用代码（后门注册等） | 文档建议用户在 App 代码中写 `if (process.env.EXPO_PUBLIC_QUIESCO === '1') { … }` | ✅ App 代码中的环境变量守卫可以完全剔除模块（方案 A） |

**e2e 构建的判定**：统一使用 `EXPO_PUBLIC_QUIESCO=1`。Metro 构建时（JS）和 prebuild 时（原生）都读取同一个变量。

## 1. JS：方案对比

验证方法：在 agent 模块中放入特征字符串，用 `expo export --platform all` 分别导出 e2e 关闭和开启两种模式，然后在 Web 的 JS 和 iOS/Android 的 Hermes 字节码（`.hbc`）中 grep。

| 方案 | 写法 | e2e 关闭 | e2e 开启 | 评价 |
|---|---|---|---|---|
| A | App 代码中 `if (process.env.EXPO_PUBLIC_QUIESCO === '1') require('./agent')` | 三端都不存在（Web 模块数 469，开启时 470） | 存在 | 有效，但只限于 App 代码 |
| A′ | **同样的守卫写在 node_modules 包内部** | **存在**（产物中保留了对 `process.env.EXPO_PUBLIC_QUIESCO` 的引用） | 存在 | ❌ babel-preset-expo 不会在 node_modules 中内联 `EXPO_PUBLIC_*` |
| B | `metro.config.js` 的 `resolver.resolveRequest` 在非 e2e 时返回桩文件 | 三端都不存在 | 存在 | ✅ 采用 |

- 方案 A 有效，说明 Metro 和 Babel 在收集依赖之前，就已经把内联后的死分支去掉了（不只是「不执行」，而是模块本身没有被打包）。
- 由于 A′ 无效，库作者无法靠代码本身保证被剔除 ⇒ 必须让用户在 `metro.config.js` 中接入 Quiesco（`quiesco init` 自动完成；`quiesco doctor` 检查是否已接入）。

Phase 1 中 `withQuiesco` 的草案：

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withQuiesco } = require('@quiesco/agent/metro');
module.exports = withQuiesco(getDefaultConfig(__dirname));
// 非 e2e：'@quiesco/agent' → '@quiesco/agent/stub'
```

## 2. 原生：autolinking 排除

- `expo-modules-autolinking` 的排除选项只有两个来源：`package.json` 的 `expo.autolinking.exclude`（静态）和 CLI 的 `--exclude`。
  - iOS：Podfile 的 `use_expo_modules!(exclude: [...])` 会作为 `--exclude` 传入（`scripts/ios/autolinking_manager.rb:215`）。
  - Android：settings.gradle 中 `expoAutolinking.exclude = [...]` 写在 `expoAutolinking.useExpoModules()` 之前（`ExpoAutolinkingSettingsExtension.kt`）。
- config plugin（`withPodfile` + `withSettingsGradle`）在非 e2e 的 prebuild 时注入上述配置，e2e 时保持原样。
- 实测（主项目 `expo prebuild --clean`）：

| 模式 | Podfile | settings.gradle | iOS Podfile.lock 中的 `SpikeTouch` | Android APK 中含 `"SpikeTouch"` 的 dex 文件数 |
|---|---|---|---|---|
| 生产（未设置环境变量） | `use_expo_modules!(exclude: ['spike-touch'])` | `expoAutolinking.exclude = ["spike-touch"]` | **0** | **0**（release，R8） |
| e2e（`EXPO_PUBLIC_QUIESCO=1`） | `use_expo_modules!` | 无 | 4 | 1（debug） |

**为什么采用「默认排除」**：即使把 `@quiesco/native` 放在 devDependencies 中，autolinking 仍会扫描到它。只要 plugin 已登记，没有设置环境变量的构建就会把它排除。

## 3. 验证中踩到的坑（CI 检查脚本要注意）

1. **用副本验证无效**：把 `node_modules` 做成符号链接、在副本中 prebuild 时，`expo-modules-autolinking search` 能找到本地模块，`resolve` 却把它过滤掉了，两种模式都没有该模块 ⇒ 必须在真实的项目目录中验证。
2. **R8 混淆**：SDK 58 的 release 构建默认 `android.enableMinifyInReleaseBuilds=true`，包名会被改掉，按类名（`Lexpo/modules/…`）检查时连对照组都是 0 ⇒ **CI 要检查不会被混淆的字符串**（例如 Expo Module 的 `Name("…")`、JS 的特征字符串）。
3. **iOS**：Podfile.lock 中没有该 pod，就说明它没有被编译。最终二进制的符号检查（`nm` 查找 `QSTouchInjector`、`IOHIDEventCreateDigitizerEvent`）留到 Phase 4 的 CI 中实现。

## 4. 风险

- **用户忘记登记 plugin**：如果安装了 `@quiesco/native` 却没有登记 plugin，原生模块（含私有 API）会进入生产二进制。对策：
  1. `quiesco init` 自动登记；
  2. `quiesco doctor` 检查；
  3. `@quiesco/native` 的原生代码在初始化时检查构建标志（例如 plugin 注入的 Info.plist 键或 Android manifest meta-data），没有标志时注入功能自行失效；
  4. 在 Phase 4 的 CI 中检查生产二进制。
- **prebuild 与 build 使用的环境变量必须一致**：EAS Build 中通过 profile 的 `env` 设置，CNG 方式下每次构建都会重新执行 prebuild，因此不会出问题；但如果把原生目录提交到 git（非 CNG），切换模式时需要 `prebuild --clean`。在文档中写明。
- `withQuiesco` 依赖 Metro 的 `resolver.resolveRequest` API；Metro 的大版本更新时需要回归测试。
