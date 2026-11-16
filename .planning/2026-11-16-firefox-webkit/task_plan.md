# Task Plan: Web 端 Firefox / WebKit 支持

## Goal
Firefox、WebKit 与 Chromium 一起作为 Web 端的正式验收对象（HU 2026-11-16）：Chromium 才有的能力在其他浏览器上尽量给出替代实现，确实做不到的报 `ACTION_NOT_SUPPORTED` 并说明原因（不再漏出 Playwright 原始错误）；修掉 WebKit 下拖动类动作的 bug；新增浏览器标签；doctor / init / 文档三语写明各浏览器的支持程度；CI Web 矩阵加 Firefox、WebKit。

## Current Phase
F.1 完成（分支 `feat/firefox-webkit`，未提交）

## Next Step
F.2：查 WebKit 下拖动失效（排序、滑块、快速滑动）的根因。

## 背景
- 原计划 `.planning/2026-11-07-quiesco/` §11-6（HU 2026-11-08）：第一版只验收 Chromium；provider 可配 `firefox` / `webkit`，但从没实跑过。`requirements.md:46`：Firefox、WebKit 尽力支持。
- 工作约定沿用 `.planning/2026-11-07-quiesco/task_plan.md`「工作约定」。和 HU 交流用中文。
- Playwright 1.65.0：firefox-1572、webkit-2388（本机已装）。
- 基线结果、失败明细见 findings.md。
- 示例配置已加 `QUIESCO_BROWSER`（chromium / firefox / webkit，默认 chromium），未提交。

## 基线（2026-11-16，示例 App 92 场景，bail 关闭）
| 视口 | Chromium | Firefox | WebKit |
|------|----------|---------|--------|
| 手机（触摸） | 79 / 0 失败 | 73 / 6 | 67 / 12 |
| 桌面 | 74 / 5（双指手势要求触摸视口，符合预期） | 73 / 6 | 68 / 11 |

## 方案（推荐）
1. **CDP 依赖**（两处：`provider.ts:585` 多指触摸、`provider.ts:390` 断网）：
   - 多指触摸：先 spike 不靠 CDP 的办法——页面里派发合成的 PointerEvent / TouchEvent（RNGH web 走 pointer events）。可行 ⇒ 非 Chromium 用它；不可行 ⇒ 非 Chromium 报 `ACTION_NOT_SUPPORTED`（附 hint：用 Chromium 跑，或用平台 / 浏览器标签跳过）。
   - 断网：非 Chromium 上请求照样被拦截；`navigator.onLine` / NetInfo 的变化改为在页面里覆盖 `navigator.onLine` 并派发 `offline` / `online` 事件（spike 先确认 NetInfo 在 Firefox / WebKit 上听哪个）。做不到的部分写进文档。
2. **WebKit 拖动失效**（排序、滑块；两种视口都失败）：先查根因（mouse 事件到了没有、PointerEvent 的 buttons / pointerType、RNGH 或 PanResponder 在 WebKit 下的判定）再修。
3. **WebKit 的平台限制**：运行时撤销定位权限、剪贴板权限、移动端 WebKit 不支持 `mouse.wheel`——逐个确认是否有绕法（如剪贴板改走页面内的 `document.execCommand` / 注入、wheel 改用 drag 或页面内 `scrollBy`）；没有就报 `ACTION_NOT_SUPPORTED` 并说明。
4. **浏览器标签**：示例里只在 Chromium 能跑的场景，用浏览器标签（如 `@chromium-only` 或复用现有平台标签机制）跳过，保证三个浏览器全量 0 失败。需确认现有标签机制能否按浏览器区分（见 D3）。
5. **doctor / init**：doctor 按配置的 `devices.web.browser` 检查对应浏览器是否已装；init 提示装哪个。
6. **文档三语**：platforms 加「浏览器」对照表（每项能力在 Chromium / Firefox / WebKit 上的支持程度）；api 的 `devices.web.browser` 说明；troubleshooting 收录相关错误。
7. **CI**：按 D4 决定是否把 Firefox / WebKit 加进 Web 冒烟矩阵。

## HU 决定（2026-11-16）
| # | 问题 | 决定 |
|---|------|------|
| D1 | 多指手势在非 Chromium 上：先 spike 合成事件，还是直接报不支持 | 先 spike 合成事件（半天以内）；不稳定就报不支持（按推荐） |
| D2 | 支持定位 | **两者都正式支持**（推荐的是 WebKit 尽力支持，HU 选了正式）⇒ F.3 的 WebKit 限制要尽量找绕法，确实做不到的项报 `ACTION_NOT_SUPPORTED`、文档写明，并用浏览器标签让示例全量 0 失败 |
| D3 | 只在部分浏览器能跑的场景怎么跳过。现有标签机制（`packages/core/src/tags.ts`）只认平台 `@ios` / `@android` / `@web` / `@native`，没有浏览器维度 | **新增** `@chromium` / `@firefox` / `@webkit`（按推荐）：只约束 web，iOS / Android 照常跑；和平台标签一样「最内层决定」，可在 `tags` 配置里改名；三个 runner 适配器共用。另一个办法是不加机制，示例按浏览器用 cucumber `--tags 'not …'` 排除——简单，但 Vitest / Jest 用户没有对应写法 |
| D4 | CI 矩阵 | **两个都加**，各跑 SDK 58 一格（Linux 上的 WebKit 行为可能与 macOS 不同，CI 上首跑时留意） |

## Phases
### F.0 调研与计划
- [x] 三个浏览器 × 两种视口跑示例全量（findings）
- [x] 失败归类、定位到代码
- [x] HU 确认方案与 D1–D4（2026-11-16）
- **Status:** complete

### F.1 CDP 依赖的降级 / 替代
- [x] spike：多指合成事件——三个浏览器 × 两种视口都能驱动 RNGH 的捏合 / 旋转 / 双指滑动（findings）
- [x] spike：断网——NetInfo 在 Firefox / WebKit 上读 `navigator.onLine` + 听 window `online` / `offline`
- [x] 实现：`packages/web/src/synthetic-touch.ts`（PointerEvent + TouchEvent，合成 pointerId 的 capture 由页面内接管；WebKit 用 `document.createTouch` / `createTouchList`）；`setOnLineInPage`（覆盖 `navigator.onLine` + 派发事件）；Chromium 仍走 CDP。非 Chromium 上不再调用 CDP
- [x] 测试：provider.test 新增 Firefox / WebKit 各 2 个（多指事件序列与 Chromium 相同、capture 不抛错且方法还原；断网 / 恢复 / 离线重启 / reset，WebSocket 不受影响）；`pnpm check` 893 通过
- [x] 实跑：gestures.feature Firefox、WebKit 各 5 通过；device.feature 离线场景两者通过；全量 Firefox **79 / 13，0 失败**（与 Chromium 相同），WebKit 73 / 13 / 6 失败（都是 F.2、F.3 的项）；Chromium 回归 79 / 13
- **Status:** complete

### F.2 WebKit 拖动
- [ ] 查根因（排序、滑块），修复；单元测试
- **Status:** pending

### F.3 WebKit 平台限制
- [ ] 撤销定位权限、剪贴板、mobile wheel：逐项确认绕法或报不支持
- **Status:** pending

### F.4 示例、doctor / init、文档
- [ ] core `tags.ts`：浏览器标签（只约束 web，最内层决定，可改名）；cucumber / vitest / jest 适配器拿到当前浏览器；单元测试
- [ ] 示例：`QUIESCO_BROWSER` 提交；做不到的场景打浏览器标签
- [ ] doctor / init 按配置的浏览器检查和提示；单元测试
- [ ] 文档三语（platforms 浏览器对照表、api、troubleshooting）；plugin references
- **Status:** pending

### F.5 验收
- [ ] 三个浏览器 × 手机 / 桌面视口全量 0 失败（不支持的项按标签跳过）
- [ ] Chromium 结果不变（79 / 13）；iOS / Android 不受影响（只改 web 包时不跑原生全量，改了 core / agent 则跑）
- [ ] `pnpm check`、`docs:check`
- [ ] CI 矩阵加 Firefox、WebKit（SDK 58 各一格）
- **Status:** pending

## Decisions Made
| 日期 | 决定 | 依据 |
|------|------|------|
| 2026-11-16 | D1 先 spike 合成事件；D2 Firefox、WebKit 都正式支持；D3 新增浏览器标签；D4 CI 加 Firefox、WebKit | HU |
| 2026-11-16 | 开这个计划 | HU |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
