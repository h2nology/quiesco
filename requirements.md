# Quiesco 需求与设计说明

> React Native（Expo）用的 E2E 灰盒测试工具，覆盖 iOS、Android 与 Expo Web，以 Cucumber（Gherkin）驱动。
> 本文档是交给 Claude Code 的开发输入。请先通读全文，再从「第 0 阶段」开始实施。

---

## 1. 背景

原计划在项目中使用 Detox 做 E2E 测试，但遇到以下问题：

- Detox 官方明确声明不支持 Expo，Expo 相关支持完全依赖社区。
- Detox 社区活跃度低，对新版本 React Native 的支持明显滞后。
- Detox 的同步和元素查询都实现在原生层（iOS: EarlGrey，Android: Espresso），与 RN 内部实现强耦合，RN 升级时容易失效。

现有替代品 Maestro 支持 Expo、易用，但它是纯黑盒工具（从 App 外部看屏幕），没有 Detox 最有价值的「灰盒同步」能力，也不以 Cucumber 驱动。

**Quiesco 的定位：Detox 的灰盒能力 + Maestro 的易用性 + Cucumber 驱动 + 原生支持 Expo（iOS / Android / Web 三端）。**

补充：Detox 官方只支持 Jest 一种测试运行器（Detox 20 起放弃了 Mocha），Detox + Cucumber 的用法都是社区借助其 Internals API 自行接入的，资料零散、维护状况不一。Quiesco 把 Cucumber 作为一等公民官方支持，同时保持核心与运行器解耦。

名称来自拉丁语 quiesco（我静下来），对应工具的核心机制：等 App 进入静止（quiescent）状态后再执行下一步。

---

## 2. 目标与非目标

### 2.1 目标

1. **灰盒同步**：自动等待 App 空闲再执行动作和断言，测试代码中不需要也不应该出现 `sleep`。
2. **原生支持 Expo**：通过 config plugin 集成，走 prebuild / CNG，不需要 eject；支持 EAS Build。
3. **Cucumber 驱动**：基于 cucumber-js，feature 文件用业务语言书写。
4. **快**：单个场景的固定开销（重置 + 准备数据）以毫秒到百毫秒计，而不是 Detox 那样以秒计。
5. **简单易用**：一条命令初始化，零配置即可在 dev client 上跑起来。
6. **对 RN 版本变化有韧性**：智能放在 JS 层，原生层做到最薄。
7. **核心与测试运行器解耦**：`@quiesco/core` 不依赖任何测试运行器。Cucumber（`@quiesco/cucumber`）是第一版唯一的官方适配器；Jest、Vitest 等适配器作为后续扩展，只需编写 World / hooks 层的接线，不改动核心。
8. **一份测试，三端运行**：同一份 feature 与 step definition，通过切换目标平台即可在 iOS、Android、Expo Web 上运行。Web 端同样具备灰盒同步、后门、软重置等全部能力。

### 2.2 非目标（第一版不做）

- 不支持非 Expo 的裸 RN 项目（架构上不排斥，但不作为第一版的验收对象）。
- 不支持真机（只支持 iOS Simulator 和 Android Emulator）。
- 不做可视化录制器、云端设备农场。
- 不测试 WebView 内部内容。
- Web 端只测试由 Expo（react-native-web）渲染的部分；页面中不经过 React 渲染的第三方 DOM（广告、嵌入的外部脚本等）不保证可查询。
- Web 端第一版只以 Chromium 作为验收对象；Firefox、WebKit 尽力支持，不作为验收条件。
- 不提供 Jest / Vitest 适配器（架构上预留，后续版本再做）。
- 不支持旧架构（Paper / Bridge）。只支持 New Architecture（Fabric）。开发前请查证当前 Expo SDK 的默认架构状态。

---

## 3. 设计原则

1. **JS 优先，原生最薄**：元素查询、空闲检测、状态重置、后门调用全部在 App 内的 JS agent 实现。原生层只负责注入真实触摸事件。这也是三端共用一个 agent 的前提：agent 的核心逻辑在 iOS、Android、Web 上是同一份代码。
2. **平台差异只存在于两个边界**：App 内的 `fiber-adapter`（react-native 渲染器与 react-dom 渲染器的差异）和 Host 侧的 `DeviceProvider`（simctl / adb / Playwright 的差异）。这两个边界之外的代码不得出现平台分支。
3. **React 内部实现必须隔离**：所有访问 Fiber 内部字段的代码集中在一个模块（`fiber-adapter`），其他代码不得直接访问 Fiber 字段。React 版本变化时只改这一处。
4. **生产包零残留**：agent 和原生模块只在 e2e 构建中生效，生产构建（包括 Web 的生产 bundle）中必须被完全剔除（tree-shake + config plugin 条件注入）。需要有自动化检查验证这一点。
5. **Gherkin 是需求，不是脚本**：工具核心只提供 Driver API，不鼓励「点击 xxx 按钮」式的通用步骤。通用步骤作为可选包提供，并在文档中注明只适合原型期。
6. **失败必须可诊断**：任何超时或失败都要输出足够的上下文（哪些资源在忙、当前元素树、截图），不能只有一句「元素未找到」。
7. **核心不绑定运行器**：`@quiesco/core` 不得依赖 `@cucumber/cucumber`，也不得依赖任何测试运行器的全局对象或生命周期。

---

## 4. 整体架构

```
┌──────────────────── Host（Node.js） ────────────────────┐
│ cucumber-js                                             │
│   └ step definitions（业务语言）                         │
│       └ Driver（@quiesco/core）                          │
│           ├ WebSocket Server  ←───────────┐             │
│           └ DeviceProvider                │             │
│               ├ ios     （simctl）         │             │
│               ├ android （adb）            │             │
│               └ web     （Playwright）     │             │
└───────────────────────────────────────────┼─────────────┘
                                            │ JSON-RPC over WebSocket
┌──────────────── App（e2e 构建） ───────────┼─────────────┐
│ @quiesco/agent（JS）                       │             │
│   ├ Connection   ──────────────────────────┘             │
│   ├ Query        遍历 Fiber 树查找元素                    │
│   ├ Sync         网络 / 定时器 / React / 画面稳定 空闲检测 │
│   ├ Actions      坐标计算，调用原生注入或 JS 快速档        │
│   ├ Reset        清存储 + 重挂载根组件                    │
│   └ Backdoor     App 注册的测试专用函数                   │
│ @quiesco/native（Expo Module，薄，仅 iOS / Android）      │
│   └ Touch Injection                                       │
└──────────────────────────────────────────────────────────┘
  Web 端：同一个 agent 运行在浏览器中；真实输入由 Host 侧的
  Playwright 注入（agent 提供坐标），不需要 native 模块。
```

连接方向：**App 主动连接 Host**。Host 启动 WebSocket Server，App 启动时 agent 读取连接参数并连上。

- Android Emulator：Host 执行 `adb reverse tcp:<port> tcp:<port>`，App 连接 `localhost:<port>`。
- iOS Simulator：直接连接 `localhost:<port>`。
- Web：浏览器中的 agent 直接连接 `localhost:<port>`。
- 连接参数（端口、session id）通过启动参数或深链接传入，具体方式在第 0 阶段确定。

---

## 5. Monorepo 结构

使用 pnpm workspaces，全部 TypeScript（strict）。

```
quiesco/
├── packages/
│   ├── agent/          # @quiesco/agent        App 内 JS agent
│   ├── native/         # @quiesco/native       Expo Module（触摸注入）
│   ├── expo-plugin/    # @quiesco/expo-plugin  Expo config plugin
│   ├── core/           # @quiesco/core         Host 侧：WS Server、Driver、iOS/Android DeviceProvider（不依赖任何测试运行器）
│   ├── web/            # @quiesco/web          Web DeviceProvider（依赖 playwright 库，按需安装）
│   ├── cucumber/       # @quiesco/cucumber     cucumber-js 的 World / hooks 接线（第一版唯一的运行器适配器）
│   ├── steps/          # @quiesco/steps        可选的通用步骤（仅原型期使用）
│   ├── protocol/       # @quiesco/protocol     Host 与 agent 共享的协议类型定义
│   └── cli/            # quiesco               命令行（init / test / doctor）
├── examples/
│   └── todo-app/       # 用于验收的 Expo 示例 App + features/
└── docs/
```

`@quiesco/protocol` 只包含类型和常量，agent 和 core 都依赖它，保证两端协议一致。

依赖方向约束：

- `core` 不依赖 `cucumber`、`web`、`playwright`。
- `web` 依赖 `core`，并依赖 `playwright` 库本身（**不是** `@playwright/test`，后者是一个完整的测试运行器，会与 cucumber-js 冲突）。只测原生端的用户不需要安装 Playwright。
- `cucumber` 依赖 `core`；`web` 通过 `DeviceProvider` 插件机制被 `core` 在运行时按配置加载。
- 将来新增的 `@quiesco/jest`、`@quiesco/vitest` 与 `cucumber` 处于同一层级，同样只依赖 `core`。

---

## 6. 功能需求

### 6.1 元素查询（agent / Query）

**实现方式**：通过 `__REACT_DEVTOOLS_GLOBAL_HOOK__` 获取 renderer 与根 Fiber（React DevTools 的做法），遍历 Fiber 树。

原生端的 renderer 是 react-native（Fabric），Web 端是 react-dom（经由 react-native-web）。两者宿主组件的判定方式、坐标获取方式、props 形态不同，这些差异全部封装在 `fiber-adapter` 中，向上提供统一的元素模型：

- 原生端：坐标通过 `measure` 或 Fabric 下的等价 API 获取（第 0 阶段验证）。
- Web 端：宿主节点是 DOM 元素，坐标通过 `getBoundingClientRect()` 获取（CSS 像素，与 Playwright 的鼠标坐标系一致）。
- `testID` 在 Web 端会被 react-native-web 映射为 DOM 属性（以第 0 阶段实测为准）；查询仍以 React props 为准，不依赖 DOM 属性。

**查询条件（Matcher）**，可组合：

| 字段 | 含义 |
|---|---|
| `id` | `testID` 精确匹配 |
| `text` | 文本内容，支持字符串精确匹配与正则 |
| `label` | `accessibilityLabel` |
| `role` | `accessibilityRole` |
| `within` | 嵌套的 Matcher，限定在某个祖先元素内查找 |
| `index` | 多个匹配时取第几个 |

**要求**：

- 只返回宿主组件（host component，即最终渲染为原生视图的节点）。
- 能判断元素是否可见：在屏幕范围内、未被 `display: none` 隐藏、透明度不为 0。可见性判定规则写入文档。
- 能获取元素的屏幕坐标与尺寸（各平台实现见上文）。
- 能读取元素的 props（用于断言，例如 `disabled`、`value`、`checked`）。
- 多个匹配但未指定 `index` 时，动作类操作报错并列出所有匹配；断言类操作按断言语义处理。
- 提供 `getTree()`：导出当前元素树的精简 JSON（类型、testID、文本、role、坐标），用于失败诊断。

### 6.2 灰盒同步（agent / Sync）—— 最高优先级

每个动作执行后、每个查询执行前，自动等待 App 空闲。

**空闲 = 以下条件同时满足：**

1. **网络空闲**：进行中的 `fetch` / `XMLHttpRequest` 数为 0。通过 patch 全局对象跟踪。
   - 可配置忽略的 URL 模式（长轮询、SSE、分析上报等）。
   - WebSocket 连接不计入（包括 agent 自身的连接）。
2. **定时器空闲**：没有「延迟 ≤ 阈值」的待触发 `setTimeout`。阈值默认 1500ms，可配置。`setInterval` 默认不计入，可配置。
3. **React 空闲**：没有待提交的渲染工作。
4. **空闲回调空闲**：没有挂起的 `requestIdleCallback`（tracker 名 `idle-callback`）。RN 0.88（Expo SDK 58）已移除 `InteractionManager`，官方建议改用 `requestIdleCallback`；在仍存在 `InteractionManager` 的旧版本上，同时跟踪其挂起任务。（2026-11-07 HU 确认的需求变更）
5. **画面稳定（兜底）**：元素树的结构哈希（类型、文本、坐标取整）连续 N 帧不变，N 默认 2。这一项用于覆盖 Reanimated 等运行在 UI 线程、JS 侧不可见的动画。

**要求**：

- 每个信号做成独立的 tracker，实现统一接口，便于开关和扩展：

  ```ts
  interface IdleTracker {
    name: string;
    isIdle(): boolean;
    describeBusy(): string[];   // 例如 ["GET https://api.example.com/todos (1200ms)"]
    install(): void;
    uninstall(): void;
  }
  ```

- 等待超时（默认 10s，可配置）时抛出错误，错误信息必须列出每个处于忙碌状态的 tracker 及其 `describeBusy()` 内容。
- 支持在单个动作上临时关闭同步（`{ sync: false }`），用于测试无限动画等特殊界面。
- 支持全局开关某个 tracker（配置文件）。
- 上述 tracker 在 Web 端全部复用（浏览器中同样存在 `fetch`、`XMLHttpRequest`、定时器、React 调度）。Web 端额外处理：
  - 如果使用了 Expo Router 的静态渲染输出，需等待 hydration 完成后才认为就绪。
  - 页面跳转（整页刷新）后 agent 会重新连接，Host 需透明地等待重连，不能把重连期间的断开当作错误。

### 6.3 动作（agent / Actions + native）

两档实现：

| 档位 | 实现 | 特点 | 用途 |
|---|---|---|---|
| `native`（默认） | 计算元素中心坐标，交给原生层注入真实触摸 | 经过命中测试，行为与用户一致 | 正式验收 |
| `js` | 直接调用组件的 `onPress` 等回调 | 无需原生代码，极快；会跳过命中测试 | 本地快速迭代、Expo Go |

Web 端的 `native` 档位：由 agent 计算坐标，Host 侧通过 Playwright 的 `page.mouse` / `page.keyboard` / `page.touchscreen` 注入真实输入事件。文本输入走 Playwright 的键盘输入，而不是直接改 DOM 的 value。

**动作清单**：

- `tap(matcher)`、`longPress(matcher, durationMs?)`、`doubleTap(matcher)`
- `type(matcher, text)`：向输入框输入文本；`clear(matcher)`
- `scroll(matcher, direction, distance?)`、`scrollTo(containerMatcher, targetMatcher)`：滚动直到目标可见
- `swipe(matcher, direction, speed?)`
- `pressBack()`：Android 为系统返回键；Web 为浏览器后退；iOS 不支持（调用时报错并提示改用业务上的返回操作）
- `openUrl(url)`：通过深链接（原生）或地址栏（Web）打开指定页面，用于直接进入某个状态
- `dismissKeyboard()`

**原生触摸注入**：

- Android：在 App 进程内构造 `MotionEvent`，通过 `Activity.dispatchTouchEvent` 分发。只使用公开 API。
- iOS：合成 `UITouch` / `UIEvent`（参考 KIF 的实现思路）。会使用私有 API，因此**必须只编入 e2e 构建**。这是技术风险最高的部分，在第 0 阶段做 spike。
- 原生模块使用 Expo Modules API 实现。

`js` 档位下 `type` 的实现：调用 `onChangeText`，并在可能的情况下同步更新受控组件的值。具体行为在文档中写清楚限制。

### 6.4 断言

Driver 提供以下断言，内部自带等待（在超时前反复检查，配合 Sync）：

- `expectVisible(matcher)` / `expectNotVisible(matcher)`
- `expectExists(matcher)` / `expectNotExists(matcher)`
- `expectText(matcher, textOrRegex)`
- `expectProp(matcher, propName, value)`
- `expectCount(matcher, n)`

断言失败时的错误信息要包含：期望值、实际值、匹配到的元素摘要。

### 6.5 状态重置（agent / Reset）

**软重置**（默认，每个场景开始前执行）：

1. 清空持久化存储：AsyncStorage；如项目使用 MMKV、SecureStore，则通过适配器清空。存储适配器可由用户注册。
2. 调用用户注册的自定义重置钩子（例如清空状态管理库的 store、重置 React Query 缓存）。
3. 给根组件更换 `key`，强制重新挂载整棵树。
4. 等待空闲后返回。

**硬重置**（可选，按 tag 或配置启用）：终止并重新启动 App 进程。

**Web 端**：软重置流程相同，存储清理改为清空 `localStorage`、`sessionStorage`、IndexedDB（存储适配器按平台选择实现）。硬重置为关闭当前浏览器 context 并新建一个（cookie、存储天然隔离，开销通常只有几十毫秒），然后重新加载 App。

目标：软重置在 Emulator 上 < 500ms（以实测为准，记录在性能基准中）。

### 6.6 后门（agent / Backdoor）

App 侧注册测试专用函数，测试侧直接调用，用于 Given 步骤准备数据，不走 UI。

App 侧：

```ts
import { quiesco } from '@quiesco/agent';

quiesco.backdoor('loginAs', async (email: string) => {
  await authStore.setSession(await testApi.createSession(email));
});

quiesco.backdoor('seedTodos', (titles: string[]) => {
  todoStore.replaceAll(titles);
});

quiesco.onReset(async () => {
  todoStore.clear();
  queryClient.clear();
});
```

测试侧：

```ts
await this.app.backdoor('loginAs', 'a@example.com');
```

要求：

- 参数和返回值必须可 JSON 序列化，否则报清晰的错误。
- 调用未注册的后门时，错误信息列出所有已注册的后门名称。
- 后门执行完成后自动等待空闲。

### 6.7 App 入口集成

用户只需要在 App 入口包一层：

```tsx
import { QuiescoRoot } from '@quiesco/agent';

export default function App() {
  return (
    <QuiescoRoot>
      <RealApp />
    </QuiescoRoot>
  );
}
```

- 非 e2e 构建中，`QuiescoRoot` 直接返回 children，且 agent 代码被剔除。判定方式通过构建期环境变量（例如 `EXPO_PUBLIC_QUIESCO=1`）实现，第 0 阶段确定最终方案。
- `QuiescoRoot` 负责：启动连接、安装 trackers、提供重挂载用的 key。

### 6.8 Expo 集成（expo-plugin）

- 提供 config plugin，在 `app.json` / `app.config.ts` 的 `plugins` 中添加即可。
- plugin 只在 e2e 构建（由环境变量判定）时注入原生模块和所需配置；否则不做任何修改。
- 提供 `eas.json` 中 `e2e` 构建 profile 的示例（模拟器构建，iOS 为 simulator build，Android 为 APK）。
- **JS-only 模式**：不安装原生模块时，自动降级为 `js` 动作档位，且能在 dev client 上运行。是否能在 Expo Go 运行，在第 0 阶段验证后写入文档。
- **Web 构建**：支持两种被测对象：
  - 静态导出：`npx expo export --platform web` 生成的产物目录，由 Quiesco 内置的静态文件服务器托管（需要支持 SPA 的路由回退）。用于 CI。
  - 开发服务器：用户自己启动的 Expo dev server 的 URL。用于本地迭代。
  - Web 端同样通过构建期环境变量启用 agent；生产 Web bundle 中不得包含 agent 代码。

### 6.9 Host 侧（core）

- **WebSocket Server**：管理与 agent 的连接（一次运行对应一台设备）。
- **Driver**：对外暴露 6.3〜6.6 的全部 API，全部为 `async`。
- **设备管理**：通过 `DeviceProvider` 接口抽象，三端各一个实现：

  ```ts
  interface DeviceProvider {
    platform: 'ios' | 'android' | 'web';
    boot(): Promise<void>;                 // 启动模拟器 / 浏览器
    install(): Promise<void>;              // 安装 App；Web 为启动静态服务器或校验 URL
    launch(params: LaunchParams): Promise<void>;  // 启动 App 并传入连接参数
    terminate(): Promise<void>;
    grantPermissions(perms: Permission[]): Promise<void>;
    screenshot(): Promise<Buffer>;
    injectInput?(input: InputEvent): Promise<void>;  // Web 端由 Playwright 实现
    shutdown(): Promise<void>;
  }
  ```

  - iOS：`xcrun simctl`（启动、安装、权限 `simctl privacy grant`、截图 `simctl io screenshot`）。
  - Android：`adb`（安装、权限 `adb shell pm grant`、截图 `adb exec-out screencap`、`adb reverse` 端口转发）。
  - Web（`@quiesco/web`）：Playwright 库。每个场景使用独立的 browser context；权限通过 `context.grantPermissions`；截图通过 `page.screenshot`；视口尺寸可配置，用于模拟手机或桌面布局。
  - 配置中的权限名使用 Quiesco 自己的统一名称（如 `camera`、`notifications`），由各 provider 映射到平台的具体名称；某平台不支持的权限给出警告而不是报错。
- **App 连接等待**：启动 App 后等待 agent 连接，超时报错并给出排查提示（端口、构建是否为 e2e 构建等）。

### 6.10 Cucumber 集成（cucumber）

- 提供 World 与 hooks，用户在 `support/` 中一行引入即可：

  ```ts
  // features/support/quiesco.ts
  import '@quiesco/cucumber/register';
  ```

- 生命周期：
  - `BeforeAll`：启动 WS Server，启动设备（或浏览器），安装并启动 App，等待连接。
  - `Before`：软重置（带 `@hard-reset` tag 的场景执行硬重置）。
  - `After`：失败时附加截图与元素树 JSON 到报告。
  - `AfterAll`：关闭连接，按配置决定是否关闭设备。
- step definition 中通过 `this.app` 访问 Driver。
- 并行执行（Phase 6.12 重做，HU 2026-11-08 决定重做；2026-11-12 确认方案）：cucumber-js `--parallel`、Jest `maxWorkers`、Vitest 多 worker；每个 worker 一台设备（iOS 同机型同 runtime 的 `"<name> (Quiesco N)"`，Android 每 worker 一个从 base 复制的 AVD，Web 各自的浏览器），自动创建并复用；配置可写成 `({ workerIndex }) => config`；端口、artifacts 按 worker 分开。
- **目标平台切换**：通过环境变量或 CLI 参数选择平台，例如 `QUIESCO_PLATFORM=web`、`quiesco test --platform android`。同一份 feature 与 step definition 不做任何修改即可在三端运行。
- **平台专属场景**：用 tag 标注只在某些平台成立的场景（如 `@ios`、`@android`、`@web`、`@native`），运行时自动跳过不匹配当前平台的场景。tag 名称可配置。
- **兼容 Driver 模式**：`this.app` 的接口设计要允许用户实现自己的业务 Driver 包装层（Ports & Adapters），例如在 Quiesco 之外再接一个纯 API 层的 Driver。文档中给出示例。
- **运行器无关**：`@quiesco/cucumber` 只是把 cucumber-js 的生命周期映射到 `core` 提供的会话 API（创建会话、场景前重置、失败时收集证据、销毁会话）。这套会话 API 要设计成任何运行器都能接，为将来的 Jest / Vitest 适配器预留。

### 6.11 通用步骤（steps，可选）

提供一小组通用步骤，例如：

```gherkin
When 点击 "add-todo"
When 在 "todo-title" 中输入 "买牛奶"
Then 看到文本 "买牛奶"
```

文档中必须注明：这类步骤是操作脚本而非需求，只适合原型期和探索，正式项目应编写业务语言的步骤。

### 6.12 CLI（cli）

| 命令 | 作用 |
|---|---|
| `quiesco init` | 在 Expo 项目中初始化：添加依赖、config plugin、`QuiescoRoot` 包装说明、`features/` 目录与示例、配置文件 |
| `quiesco test [--platform ios\|android\|web] [cucumber 参数]` | 运行测试，透传参数给 cucumber-js |
| `quiesco doctor` | 检查环境：Xcode / simctl、Android SDK / adb、模拟器、Playwright 浏览器、构建产物、端口 |
| `quiesco tree` | 连接正在运行的 App，打印当前元素树（编写测试时用于查找 testID） |

### 6.13 配置文件

`quiesco.config.ts`：

```ts
import { defineConfig } from '@quiesco/core';

export default defineConfig({
  apps: {
    ios: { binaryPath: 'build/MyApp.app', bundleId: 'com.example.myapp' },
    android: { binaryPath: 'build/app.apk', package: 'com.example.myapp' },
    web: { distDir: 'dist' },          // 或 { url: 'http://localhost:8081' } 指向开发服务器
  },
  devices: {
    ios: { type: 'simulator', name: 'iPhone 16' },
    android: { type: 'emulator', avd: 'Pixel_8_API_35' },
    web: { browser: 'chromium', viewport: { width: 390, height: 844 }, headless: true },
  },
  permissions: ['notifications', 'camera'],
  sync: {
    timeoutMs: 10_000,
    timerThresholdMs: 1_500,
    stableFrames: 2,
    ignoreUrls: [/\/analytics\//],
  },
  actions: { mode: 'native' },   // 'native' | 'js'
  reset: { default: 'soft' },
});
```

上面的设备名、API 级别、视口尺寸只是示例，不要写死在代码里。

---

## 7. 通信协议（protocol）

- 传输：WebSocket，消息体为 JSON，采用 JSON-RPC 2.0 风格（`id` / `method` / `params` / `result` / `error`）。
- 握手：agent 连接后发送 `hello`，携带 session id、平台（ios / android / web）、协议版本、agent 版本、是否安装了原生模块。Host 校验协议版本，不兼容时拒绝并给出升级提示。
- 主要方法（Host → agent）：

  | method | 说明 |
  |---|---|
  | `query` | 按 Matcher 查询元素，返回元素摘要列表 |
  | `action` | 执行动作（tap / type / scroll …） |
  | `assert` | 执行断言 |
  | `waitForIdle` | 显式等待空闲 |
  | `getTree` | 导出元素树 |
  | `reset` | 软重置 |
  | `backdoor` | 调用后门 |
  | `getIdleState` | 返回各 tracker 当前状态（调试用） |

- 事件（agent → Host）：`log`（App 侧日志转发，可配置级别）、`error`（未捕获异常、红屏）。
- 错误码：定义统一的错误码枚举（元素未找到、多个匹配、同步超时、后门未注册、协议不兼容等），放在 `@quiesco/protocol` 中。
- App 出现未捕获异常或红屏时，当前步骤立即失败，并附上异常信息。

---

## 8. 非功能需求

| 项目 | 要求 |
|---|---|
| 语言 | TypeScript strict，Node.js 使用当前 LTS |
| Expo | 支持开发时最新的稳定 Expo SDK；最低支持版本在第 0 阶段确定 |
| 架构 | 仅 New Architecture |
| 性能 | 建立基准测试并记录：软重置耗时、单次 tap（含同步）往返耗时、示例 App 全量测试耗时 |
| 稳定性 | 示例 App 的测试连续运行 20 次无随机失败 |
| 生产安全 | CI 中构建生产包，检查原生与 Web 的 bundle 中都不包含 agent 代码、原生二进制中不包含注入模块 |
| 三端一致 | 示例 App 的通用场景在三端使用完全相同的 feature 与 step definition 通过 |
| 文档 | README（5 分钟上手）、API 参考、同步机制说明、故障排查 |
| 许可证 | 待定（见第 11 节） |

---

## 9. 示例 App 与验收用 feature

在 `examples/todo-app` 中建立一个 Expo 示例 App，至少包含：登录页、待办列表、新建待办表单、带动画的页面切换、一个发起网络请求的操作（可用本地 mock server）。

示例 App 必须能以 Expo Web 运行（静态导出与开发服务器两种方式）。

验收用 feature 示例（Gherkin 关键字用英文，正文用中文）：

```gherkin
@REQ-TODO-001
Feature: 新建待办
  已登录用户可以新建待办，新建的待办显示在列表最前面。
  排除：待办的编辑与删除不在本文件范围内。

  Background:
    Given 用户 "a@example.com" 已登录

  Scenario: 新建的待办出现在列表最前面
    Given 待办列表为空
    When 新建一条标题为 "买牛奶" 的待办
    Then 列表第一条是 "买牛奶"

  Scenario: 标题为空时不能保存
    When 尝试新建一条标题为空的待办
    Then 看到提示 "请输入标题"
    And 待办列表仍然为空
```

对应的 step definition 只调用 Driver，不出现等待代码：

```ts
Given('用户 {string} 已登录', async function (email: string) {
  await this.app.backdoor('loginAs', email);
});

Given('待办列表为空', async function () {
  await this.app.backdoor('seedTodos', []);
});

When('新建一条标题为 {string} 的待办', async function (title: string) {
  await this.app.tap({ id: 'add-todo' });
  await this.app.type({ id: 'todo-title' }, title);
  await this.app.tap({ role: 'button', text: '保存' });
});

Then('列表第一条是 {string}', async function (title: string) {
  await this.app.expectText({ id: 'todo-item', index: 0 }, title);
});
```

---

## 10. 实施阶段

每个阶段结束时，所有验收条件必须通过，再进入下一阶段。

### 第 0 阶段：技术验证（spike）

目的：在写正式代码之前，验证风险最高的假设。每个 spike 产出一个最小可运行的验证代码和一页结论（写入 `docs/spikes/`）。

1. **Fiber 查询**：在当前 Expo SDK + New Architecture 下，通过 DevTools hook 获取根 Fiber，按 testID 找到宿主组件，并取得屏幕坐标。
2. **React 空闲检测**：找到判断「没有待提交渲染」的可靠方法。
3. **Android 触摸注入**：通过 `dispatchTouchEvent` 点击 RN 按钮，`onPress` 正常触发；Pressable 的按下态、手势库（react-native-gesture-handler）的点击也正常工作。
4. **iOS 触摸注入**：合成触摸事件点击 RN 按钮。若不可行，记录原因并提出替代方案（例如借助 XCUITest 进程），交由我决定。
5. **连接参数传递**：确定 Host 将端口和 session id 传给 App 的方式（启动参数 / 深链接 / 构建期注入）。
6. **生产剔除**：确认 agent 能在生产构建（原生与 Web）中被完全剔除的方案。
7. **Web 端 Fiber 查询**：在 Expo Web（react-dom + react-native-web）下，用同一套 `fiber-adapter` 接口按 testID 找到宿主节点并取得坐标；确认 react-native-web 对 testID 等属性的映射行为。

验收：7 份结论文档，其中 1〜5、7 附带可运行的验证代码。

### 第 1 阶段：核心闭环（Android + JS 档位）

- monorepo 骨架、`protocol`、`agent`（Query、Sync 全部 tracker、JS 档位动作、断言）、`core`（WS Server、Driver、Android 设备管理）、`cucumber` 接线。
- 示例 App 与第 9 节的 feature。

验收：

- 在 Android Emulator + dev client 上，第 9 节的场景全部通过。
- 人为在示例 App 中加入 2 秒延迟的网络请求和 1 秒的动画，测试无需修改仍然稳定通过。
- 同步超时时，错误信息能指出是哪个请求或定时器未完成。

### 第 2 阶段：真实触摸与速度（Android）

- `native` 模块的 Android 实现、`native` 动作档位。
- 软重置、后门、`onReset` 钩子。
- 失败时附加截图与元素树。
- 性能基准脚本。

验收：

- 第 9 节场景在 `native` 档位下通过。
- 连续运行 20 次无随机失败。
- 性能基准结果记录在 `docs/benchmarks.md`。

### 第 3 阶段：Web

先于 iOS 实施。Web 不需要原生代码、风险低，并且能尽早验证「一份 agent、多个 DeviceProvider」的平台抽象是否成立；如果抽象有问题，在接入 iOS 之前修正成本最低。

- `@quiesco/web`：Web DeviceProvider、Playwright 输入注入、静态文件服务器（含 SPA 路由回退）。
- `fiber-adapter` 的 react-dom 实现、Web 端存储适配器。
- 平台 tag 过滤与 `--platform` 切换。

验收：

- 第 9 节场景在 Android Emulator 与 Chromium 上，使用完全相同的 feature 与 step definition 通过。
- Web 端连续运行 20 次无随机失败。
- 只测原生端的项目在不安装 Playwright 的情况下可正常运行。

### 第 4 阶段：iOS 与 Expo 集成

- `native` 模块的 iOS 实现、iOS 设备管理。
- `expo-plugin`、`eas.json` 的 e2e profile 示例。
- 生产剔除的 CI 检查。

验收：

- 第 9 节场景在 iOS Simulator、Android Emulator、Chromium 三端都通过。
- 生产构建检查通过。
- iOS 端连续运行 20 次无随机失败（记录耗时）。

### 第 5 阶段：易用性与周边

- CLI：`init`、`doctor`、`tree`。
- 系统权限预授权、键盘处理。
- 可选通用步骤包 `steps`。
- 文档：README、API 参考、同步机制、三端差异说明、故障排查、Driver 模式。

验收：在一个全新的 `create-expo-app` 项目中，按 README 操作，10 分钟内在任一平台跑通第一个场景。

---

## 11. 待确认事项

以下问题由我（HU）决定，Claude Code 遇到时请暂停并询问，不要自行假设：

1. 开源许可证（MIT / Apache-2.0 / 其他）。
2. 最低支持的 Expo SDK 版本（第 0 阶段给出建议后决定）。
3. iOS 触摸注入若 spike 失败，采用哪种替代方案。
4. CI 环境：GitHub Actions 还是 EAS Workflows，或两者都支持。
5. npm 组织 `@quiesco` 的注册与发布流程。
6. Web 端是否需要在第一版就支持 Firefox / WebKit 作为验收对象（当前只要求 Chromium）。
7. Web 端的视口默认值：模拟手机布局还是桌面布局，或两者都作为验收对象。

---

## 12. 给 Claude Code 的工作约定

- 从第 0 阶段开始，按阶段推进，不要跳阶段。
- 每个阶段开始前，先输出该阶段的实施计划（任务拆分、文件清单），确认后再写代码。
- 对 React、React Native、Expo 的内部 API 或版本行为不确定时，先查阅当前官方文档或源码确认，不要凭记忆实现。
- 所有访问 Fiber 内部字段的代码只能放在 `agent/src/fiber-adapter/` 中。
- `core` 包不得依赖 `@cucumber/cucumber`、`playwright` 或任何测试运行器。在 CI 中加入依赖检查（例如 dependency-cruiser 规则）防止违反。
- 平台分支（`if (platform === 'web')` 之类）只允许出现在 `fiber-adapter`、存储适配器和各 `DeviceProvider` 实现中。
- Web 端使用 `playwright` 库，不要引入 `@playwright/test`。
- 不要在测试代码、示例 step definition 中使用固定时长等待（`sleep`、`setTimeout` 等待）。
- 每个包都要有单元测试；agent 的 tracker 逻辑必须有单元测试覆盖。
- 宣称某个阶段完成之前，实际运行验收条件中的测试并展示结果。
