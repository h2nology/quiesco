# 设计：测试自己重启 app 时，跳过白做的 soft reset

`0.14.4-optimizations.md` 第 5 项的设计。状态：**采用方案 B，名字定为 `none`，已实现**（分支 `feat/reset-none`，2026-11-28）。实测见第 9 节。

## 1. 问题

每个场景开始前，`Session.beforeScenario()`（`packages/core/src/session.ts`）依次执行：

1. `sync.reset()`：撤销上个场景的 `app.sync.*`
2. `device.resetDeviceState()`：撤销设备状态的改动（权限、定位、外观等）；iOS 上 runner 运行时还会检查残留的系统弹窗
3. soft reset（`driver.reset()`）：app 侧清存储 → 跑 `onReset` 钩子 → 导航回到起点 → 重新挂载 → 等空闲；`@hard-reset` / `reset.default: 'hard'` 时改为 terminate + launch
4. `reset.expectVisible` 的检查

不少项目在自己的 `beforeEach` 里还会重启 app 并清数据，例如 shootout：

```ts
test.beforeEach(async ({ app }) => {
  await postJson('/reset');
  await app.device.setPermission('location', 'reset');
  await app.device.relaunch({ clearData: true });
});
```

这样第 3 步的 soft reset 刚做完，进程就被结束了，它的结果全部作废。

**实测**（2026-11-28，本地 core 驱动 shootout 的 Release 构建，iOS 27 模拟器，中位数）：

| 步骤 | 耗时 |
|---|---|
| soft reset（几乎全在 app 侧：重新挂载后等空闲） | 约 460 ms |
| 恢复设备状态（这里是上个场景的 `setPermission('location', 'reset')` 恢复成撤销） | 约 180 ms（runner 运行时 +46 ms 的弹窗检查） |

能省的是 soft reset 这约 0.46 s/场景。恢复设备状态是文档规定的行为（“权限回到 config 中配置的状态”），要保留。

这部分在 harness 的计时标记之外，**不影响跑分**，影响的是用户的实际耗时（iOS 24 个场景约 11 s）。

## 2. 目标与非目标

- 目标：对“场景开头自己重启 app”的项目，不再做白费的 soft reset。
- 目标：其他项目的行为完全不变。
- 非目标：缩短 soft reset 本身（见第 7 节）；改变恢复设备状态的规则。

## 3. 方案

### A. 延迟执行 soft reset（自动）

`beforeScenario` 只执行第 1、2 步，把 soft reset 记为“待执行”。之后测试的第一个会用到 app 状态的调用之前才执行它。如果在那之前先调用了 `relaunch({ clearData: true })` 或 `relaunch({ reinstall: true })`，就取消它：新进程加上清空的数据，已经比 soft reset 更彻底。

取消的依据：`@hard-reset` 现在就是“重启进程，不跑 `onReset` 钩子”（`resetForScenario` 的 hard 分支只做 terminate + launch），所以“重启并清数据时不跑钩子”和已有的语义一致。

但是要处理的边界很多：

| 情况 | 要求 |
|---|---|
| `app.*` 的任意调用（`Driver.call`） | 先执行待执行的 reset |
| `screenshot()`、`device.system.*`（看的是屏幕） | 先执行，否则看到的是上个场景的画面 |
| `openUrl` / 深链接、通知 | 先执行，否则 reset 会把深链接打开的页面冲掉 |
| `relaunch()`（不清数据） | 先执行再重启（和现在的先后顺序一致），否则上个场景的存储会留下来 |
| `setPermission` / `setLocation` / `clearKeychain` 等设备级操作 | 不读屏幕，可以不执行；但 Android 撤销权限会杀掉 app 并重启（`afterChange`），这类会重启 app 的调用（`setLocale`、Android 的 `setFontScale`、Android 的撤销权限）要在调用前先执行 |
| 执行时连接已丢失或 app 崩溃 | 现在由 `beforeScenario` 的 `RESTART_ON` 分支重启 app；延迟后要在第一个调用里做同样的恢复 |
| `reset.expectVisible`、`RESET_FAILED` | 在第一个调用里报错，而不是在 before hook 里；失败归属和 `bailOnRepeatedFailure` 的统计会随之变化 |
| timeline / 视频 | reset 出现在第一个步骤的位置 |

- 收益：用户不用改任何东西，0.46 s/场景自动省下来。
- 风险：入口多（Driver、DeviceApi、system、截图、生命周期），漏掉一个就会出现“看到上个场景状态”这种很难查的问题；错误的归属也会变。
- 工作量：大。

### B. `reset.default: 'none'`（显式关闭）

在 `'soft' | 'hard'` 之外增加 `'none'`：`beforeScenario` 仍然执行第 1、2 步，还会把后台的 app 拉回前台、把已终止的 app 启动起来，但不做 soft reset / hard reset，也不检查 `reset.expectVisible`。单个场景仍然可以用 `@hard-reset`。

shootout 这类项目只要在 config 里加一行：

```ts
reset: { default: 'none' }, // 每个测试的 beforeEach 自己 relaunch({ clearData: true })
```

- 收益：和 A 相同（0.46 s/场景），只对设置了它的项目生效。
- 风险：只有设置了它的项目会受影响。设置了却忘了在 `beforeEach` 里自己重置，测试之间就不再隔离；文档里要写清楚。
- 工作量：小。改 config 的类型和校验、`resetForScenario` 的分支、单元测试，以及三种语言的 `config.mdx`（可能还有 `api-in-app.mdx` 的 Reset 一节和 `platforms.mdx`）。

### C. `reset.default: 'clean'` + `@clean-reset`（Quiesco 代做“重启并清数据”）

由 Quiesco 在每个场景前执行 terminate → 清数据 → 重新授予配置的权限 → launch，也就是 `relaunch({ clearData: true })`，用户不用再自己写。

- 收益：省掉 soft reset，用户的 `beforeEach` 也更短；以后在这条路径上还能做更多优化（比如和恢复设备状态合并）。
- 风险：要定义清楚各平台“清数据”的范围（iOS 不清钥匙串，Android 的 `pm clear` 会连权限一起清掉），还要新增一个 tag。
- 工作量：中。

## 4. 比较

| | A 延迟执行 | B `'none'` | C `'clean'` |
|---|---|---|---|
| 用户要改什么 | 不用 | config 加一行 | config 加一行，删掉自己的 relaunch |
| 对其他项目的影响 | 有可能（边界处理） | 无 | 无 |
| 改动范围 | session、driver、device、system、截图 | session、config、文档 | session、config、tag、文档 |
| 风险 | 高 | 低 | 中 |

## 5. 建议

**先做 B。** 它和 A 省的时间一样，对没设置的项目零影响，改动小。A 的收益是“用户不用改”，但需要自己写 `beforeEach` 重启 app 的用户本来就会去看 reset 相关的文档，显式设置的成本很低；而 A 的边界一旦漏掉，就会出现很难查的测试串状态问题，不划算。

如果以后很多用户都写同样的 `beforeEach`，再考虑 C。

## 6. B 的详细设计

- **config**：`reset.default: 'soft' | 'hard' | 'none'`，默认仍是 `'soft'`。（config 对这个字段只有类型，没有运行时校验。）
- **`Session.resetForScenario()`**：
  - `hard`（tag 或 config）→ 和现在一样
  - `'none'` → app 已终止就启动，在后台就拉回前台；不调用 `driver.reset()`，不检查 `expectInitialState()`
  - 其他 → 和现在一样
- **不变**：`sync.reset()`、`resetDeviceState()`、崩溃 / 连接丢失后的重启（`beforeScenario` 的 catch 分支）。
- **timeline**：timeline 里的 reset 一段只记录 `driver.reset()`，`'none'` 时没有这一段。
- **测试**：`session.test.ts` / `lifecycle.test.ts` 增加 `'none'` 的用例：不调用 reset，`@hard-reset` 仍然重启，已终止的 app 会被启动，在后台的 app 会被拉回前台，`expectVisible` 不检查。
- **文档**（en / zh / ja）：`config.mdx` 的 `reset.default`；`api-in-app.mdx` 的 Reset 一节写一句“`reset.default: 'none'` 时不做 soft reset，由测试自己负责”；`api-custom-runners.mdx` 的 `beforeScenario`。
- **验证**：用这次的临时工程（shootout Release 构建）跑 `'none'`，确认每个场景前的 reset 降到只剩恢复设备状态（约 0.2 s）。

## 7. 另外：soft reset 本身的耗时

- 首页写“约 200 ms 的重置”（`site/assets/i18n.js` 的 `feat.3.t` 等），`docs/index.mdx` 也写 ~200 ms；requirements 6.5 的目标是 Emulator 上 < 500 ms。
- iOS 实测约 460 ms，满足目标，但和“约 200 ms”对不上。
- Android 实测约 0.11 s（第 9 节），只有 iOS 慢。以后可以拆开看 iOS 重新挂载后等空闲时是哪个 tracker 在忙。

## 8. 决定

2026-11-28：采用 B，名字用 `none`，Android 也实测（第 9 节）。

## 9. 实测（2026-11-28）

临时工程用本地 core 驱动 shootout 的 Release 构建；每个场景先由测试自己 `relaunch({ clearData: true })`（iOS 另加 `setPermission('location', 'reset')`），再执行类似 S2 的操作。每种设置 8 个场景，中位数；第一个场景（会话启动后）不计入 soft reset 的统计。

| 平台 | soft reset（timeline 中 reset 一段） | 每个测试的实际耗时：`soft` | `none` | 省下 |
|---|---|---|---|---|
| iOS 27 模拟器 | 462 ms | 6783 ms | 6301 ms | **482 ms（7%）** |
| Android 16 模拟器 | 112 ms | 2800 ms | 2716 ms | 84 ms（3%） |

- 测试自己的重置（`relaunch` 等）和测试本身的耗时，在两种设置下基本相同，省下的就是 soft reset 那一段。
- 关于“约 200 ms 的重置”：Android 实测约 0.11 s，符合；iOS 约 0.46 s，比首页说的长，但在 requirements 6.5 “< 500 ms”的目标内。首页和 `docs/index.mdx` 要不要改成分平台的写法另外决定；iOS 等空闲的部分以后可以再拆开看。
