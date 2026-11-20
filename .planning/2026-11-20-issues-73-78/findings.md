# Findings: issues #73–#78（0.9.0 之后）

同一位用户（0.9.0、Expo SDK 58、RN 0.88 New Arch、Release 构建、iOS 27 模拟器 / Android API 36 模拟器、Vitest）。
issue 原文是外部数据，只当参考。

## #73 expo export 覆盖 dev server 的 build-config（bug）
- `packages/agent/metro.cjs:77` `writeBuildConfig` 每次加载 Metro config 都写 `.expo/quiesco/build-config.js`（dev: watching true；export: watching false, reason export）。同一个路径 ⇒ export 覆盖 dev 的文件，dev watcher 把新内容打进 dev bundle。
- resolver：`metro.cjs:170` 把 agent 的 `./build-config` 指向 `buildConfigFile`。
- 修法：按模式分文件（`build-config.dev.js` / `build-config.export.js`），resolver 指向本进程写的那个。

## #74 native-module 包装在 tracker 关闭时也装，worklet 里调用崩（严重 bug，0.9.0 回归）
- `packages/agent/src/sync/native-module.ts`：`install()` 在 app 启动时替换 `TurboModuleRegistry.get/getEnforcing` 和 `globalThis.expo.modules`，返回 Proxy，方法变成 JS wrapper。
- RNGH 3.3 `NativeProxy.ts` 解构 `flushOperations/updateGestureHandlerConfig` 后在 worklet（UI runtime）里同步调用 ⇒ wrapper 不是 HostFunction，被 Worklets 当成 remote function ⇒ 抛错 ⇒ 崩。
- 要点：关闭时（默认）必须和 0.8.0 一样完全不碰模块。但模块在 app 模块加载时就取得（早于 host config）⇒ 关闭时不装 ⇒ 打开时只能包到之后才取得的模块。

## #75 发布的 @quiesco/core dist 里有 DBG 调试行（发布事故）
- 本地 `packages/core/dist/session.js:180,191`、`dist/device.js:500` 现在仍有 `console.error("DBG …")`；src 里没有。是 0.9.0 M.C.0 复现 #66 时的临时 debug，src 还原了，但 `tsc -b` 增量构建没重新输出（dist 过期）。
- `scripts/check-release.mjs` 只检查元数据和文件列表，不检查 dist 是否由当前 src 构建。
- 修法：发版前干净构建（删 dist + tsbuildinfo），release check 里加「dist 中不应有 `DBG` / 不在 src 中的 console.*」之类检查；发 0.9.1。

## #76 app 崩溃时错误只说 close code 1006（改进）
- `packages/core/src/server/ws-server.ts:132` 抛 `AGENT_DISCONNECTED`；`src/session.ts:376` 问「did it crash or get closed?」。
- 建议：断开时检查进程是否还在（Android `pidof`，iOS simctl 进程）；不在 ⇒ `APP_CRASHED`，附 logcat `FATAL EXCEPTION` 块 / iOS `~/Library/Logs/DiagnosticReports/<app>*.ips` 的异常类型 + 栈顶；iOS 崩溃报告复制进 evidence。

## #77 崩溃后两次等满 connectTimeoutMs（改进）
- `session.ts` `currentConnection()` 断开后等 `connectTimeoutMs`（30 s）；`beforeScenario()` 要等 `resetForScenario` 失败后才重启。
- 和 #76 共用「进程是否还活着」检查：进程不在 ⇒ evidence 只收不需要 app 的东西；下一个 scenario 直接重启。

## #78 scrollTo 步内 SYNC_TIMEOUT 没有步数信息（改进）
- `packages/agent/src/runtime.ts` scrollTo 循环：`syncIfNeeded(opts, stepDeadline - now)` 原样抛 `SYNC_TIMEOUT`；`scrollToGaveUp()` 只在步数上限时用。
- 建议：包一层步信息（第几步/上限、offset、方向、之前各步耗时）；timeline 里每步一个子 span；可选 `artifacts.keep: 'all' | 'slow'`。

## 补充（代码确认）
- #74：tracker 在 `runtime.ts:1145` 创建，`installEarly` 阶段 install；`configure()`（`runtime.ts:288`）收到 host config 后才知道开关。
  模块 Proxy 的 get trap 在**访问属性时**执行 ⇒ 关闭时直接返回原始 HostFunction，RNGH 在模块加载时解构就拿到原函数（不崩）。打开后通过 `Module.method()` 访问的才包装。
  残余风险：模块对象本身仍是 Proxy（若某库把整个模块捕获进 worklet）⇒ 默认 skip 已知在 UI runtime 用的模块（RNGestureHandlerModule、Reanimated / Worklets 相关）。
- #78：`artifacts.timeline: 'all'` 已经存在（config.ts:134）⇒ issue 第三条建议（保留通过场景的 timeline）已可用，回复里说明即可。
  scrollTo 循环在 `runtime.ts:931-944`。
- #75 根因：dist/session.js mtime 11-20 08:15，src/session.ts 11-19 20:30 ⇒ 调试时直接改了 dist，src 没变 ⇒ tsc -b 认为最新，不重写 dist。修法：release:check 干净构建（删各包 dist + tsbuildinfo）。

## N.B 设计笔记（#76/#77）
- `session.ts:198` beforeScenario：resetForScenario 抛 RESTART_ON（CONNECT_TIMEOUT / AGENT_DISCONNECTED / AGENT_TIMEOUT）后才 terminate + launch。
- `session.ts:369` currentConnection：断开后 `server.waitForConnection(sessionId, connectTimeoutMs, msg, c)`。
- DeviceProvider（`devices/provider.ts`）没有「进程是否存活」；Android 已有 `pidof` 用于 diagnose（android.ts:1130），logcat 按 uid 流（android.ts:1097-1120，evidence 的 device.log）。iOS 有 `simctl spawn launchctl list`（ios.ts:1107）。
- 方案：provider 加 `isAppRunning?(): Promise<boolean | null>`（null = 不知道）与 `crashReport?(since: Date): Promise<{ summary: string; file?: string } | null>`。
  - ws-server 断开 ⇒ session 在把 AGENT_DISCONNECTED 交给用户前问 provider：进程不在 ⇒ 改成 `APP_CRASHED`（消息含崩溃摘要）。
  - currentConnection：进程已不在 ⇒ 不等 connectTimeoutMs，直接抛 APP_CRASHED；beforeScenario 的 RESTART_ON 加 APP_CRASHED。
  - Android 摘要：logcat 里 `FATAL EXCEPTION` 块（或 `Fatal signal` / `*** *** ***` native crash）；iOS：`~/Library/Logs/DiagnosticReports/<ProcessName>-*.ips`，取启动之后最新的，解析 JSON 第二段的 exception.type/signal + faulting thread 前几帧；复制进 evidence。

## N.B 实测（2026-11-20）
- Android：`adb shell am crash <pkg>` ⇒ 真正的 FATAL EXCEPTION。`adb logcat -d -b crash -v threadtime` 有：
  `E AndroidRuntime: FATAL EXCEPTION: main` / `Process: dev.quiesco.todo, PID: 2792` / 异常 / `\tat …` 栈。
  进程在 crash 之后**不是立刻**消失（几次 pidof 仍在，过一会儿才没）⇒ 存活检查要轮询几秒。
- iOS：`kill -ABRT <pid>`（模拟器进程就是 Mac 进程）⇒ 约 1 s 内出现 `~/Library/Logs/DiagnosticReports/<ProcessName>-YYYY-MM-DD-HHMMSS.ips`。
  第一行 JSON：`app_name`、`bundleID`、`timestamp`、`name`；其余 JSON：`exception {type: EXC_CRASH, signal: SIGABRT}`、`termination {indicator: "Abort trap: 6", byProc}`、`faultingThread`、`threads[n].frames[{imageIndex, symbol, symbolLocation}]`、`usedImages[i].name`、可选 `asi`、`lastExceptionBacktrace`。
  `launchctl list` 里 `UIKitApplication:<bundleId>[…]` 一行第一列是 pid；崩溃后这一行消失。
