# Spike 5：连接参数传递

- 日期：2026-11-07
- 环境：Expo SDK 58.0.23 / RN 0.88.1；Android Emulator API 37（App 的 targetSdk 为 36）；iPhone 17 Simulator / iOS 27.0；Chromium（playwright 1.65.0）
- 验证代码：
  - 原生读取：`spikes/spike-app/modules/spike-touch/{android,ios}/…SpikeTouchModule.{kt,swift}` 的 `getLaunchParams()`
  - App 侧：`spikes/spike-app/spike/s5-connect.ts`（解析参数 → 连接 WS → 发送 `hello` → 响应 `ping`）
  - Host 侧：`spikes/host/ws-host.mjs`（`ws` 库，等待 hello、校验 session、发送 ping、测量往返）
  - Web：`addInitScript` / URL query 两种方式（Playwright 脚本见下文）

## 结论

**每一端都用「启动时附带的参数」传递端口和 session id，构建期注入只作兜底。深链接不作为传参渠道。**

| 平台 | 采用的方式 | Host 侧怎么传 | App 侧怎么读 | 实测 |
|---|---|---|---|---|
| iOS | 进程启动参数 | `xcrun simctl launch <udid> <bundleId> -quiescoPort 7783 -quiescoSession <id>` | `UserDefaults.standard.string(forKey: "quiescoPort")`（`-key value` 形式会自动进入 NSArgumentDomain） | ✅ debug：从启动到连接 3.7s（含 bundle 加载），ping 1ms |
| Android | Intent extras | `am start … --es quiescoPort 7784 --es quiescoSession <id>`，端口用 `adb reverse tcp:P tcp:P` 转发 | `currentActivity.intent.getStringExtra("quiescoPort")` | ✅ debug（附在 dev client 的 VIEW Intent 上）：3.9s，ping 4ms<br>✅ release（`-n …/.MainActivity`）：2.4s，ping 10ms |
| Web | `page.addInitScript` 注入 `window.__QUIESCO__` | Playwright：`page.addInitScript(([p, s]) => { window.__QUIESCO__ = { port: p, session: s } }, [port, id])` | 读 `globalThis.__QUIESCO__` | ✅ ping 1ms |
| Web（备选） | URL query | `?quiescoPort=…&quiescoSession=…` | `URLSearchParams(location.search)` | ✅ ping 0ms。但会混进 App 的路由，整页跳转后也会丢失，**不推荐** |
| 兜底 | 构建期环境变量 | `EXPO_PUBLIC_QUIESCO_PORT` | `process.env.EXPO_PUBLIC_QUIESCO_PORT`（Metro 在构建时内联） | 未单独测试（Expo 的标准机制）。端口写死在构建里，**不支持并行时每个 worker 使用独立端口** |

所有测试中，Host 都收到了 `hello`，session 一致（`sessionMatch=true`），JSON-RPC 往返在 10ms 以内。

## 为什么不用深链接

1. **iOS**：`xcrun simctl openurl` 打开自定义 scheme 时，iOS 27 会弹出系统确认框（「"spike-app" で開きますか?」）。这个框属于 SpringBoard，simctl 无法关闭（0.1 实测）。
2. **整页刷新与硬重置**：启动参数每次启动都会重新传入；深链接则依赖 App 的 Linking 处理，并且会和 App 自己的路由冲突。
3. **dev client**：dev client 本身就靠深链接（Android）或 `--initialUrl`（iOS）来加载 bundle。Quiesco 的参数用独立的 key 附加上去即可，两者互不干扰（实测：Android 的 VIEW Intent 上同时带 URL 和 extras，读取正常）。

## 平台注意事项（实现 DeviceProvider / config plugin 时）

### Android

- **`adb shell am start` 的参数要整体加引号**：URL 中的 `&` 会被设备端 shell 当作命令分隔符（0.1 实测）。
- **明文 `ws://localhost`**：release 构建的合并 manifest 中**没有** `usesCleartextTraffic`，也没有 `networkSecurityConfig`（targetSdk 36），但实测中 WS 连接**没有被拦截**。官方说明是 Android 9 以后默认禁止 cleartext，连 localhost 也需要显式放行。实测与文档不一致，原因未查明（可能是 RN 的 OkHttp WebSocket 路径没有经过这项检查）。⇒ **e2e 构建由 config plugin 加入 network security config，显式放行 `localhost` / `127.0.0.1` 的明文连接**，不依赖这种行为。
- **`ACCESS_LOCAL_NETWORK`（Android 17 / API 37）**：
  - 官方文档：只有 targetSdk ≥ 37 的 App 才强制要求；targetSdk ≤ 36 的 App 保留旧的开放访问。SDK 58 的 targetSdk 是 36，因此 `pm revoke` 无效（权限一直是 `granted=true`）。
  - 0.1 中出现的授权弹窗，推测来自 dev launcher 主动申请权限（debug 构建）。
  - 官方文档没有说明 loopback 是否豁免（社区观点认为豁免，但未经官方确认）。
  - ⇒ Android DeviceProvider 在 launch 前执行 `pm grant <pkg> android.permission.ACCESS_LOCAL_NETWORK`，失败时忽略；等 Expo 把 targetSdk 提到 37 时再验证。
- 模拟器屏幕休眠时，App 不会被带到前台 ⇒ `boot()` 中要执行 `input keyevent KEYCODE_WAKEUP` 和 `svc power stayon true`。

### iOS

- `-key value` 形式的参数可以与 dev client 的 `--initialUrl <url>` 同时传入，互不影响。
- ATS：Expo 生成的 Info.plist 在所有构建配置中都设置了 `NSAllowsLocalNetworking = true`，因此 release 构建也能连接 `ws://localhost`（**iOS release 未实测**，依据配置判断）。
- 模拟器与 macOS 共用 localhost，不需要端口转发。
- 重启模拟器后，要先等 `xcrun simctl bootstatus <udid> -b` 返回再执行 launch，否则启动请求会丢失（S1 实测）。

### Web

- `addInitScript` 会在页面的每个文档加载之前执行，因此**整页刷新后参数依然存在**，正好满足需求 §6.2 中「页面跳转后 agent 透明重连」的要求。

## 握手时序（供 Phase 1 参考）

1. Host 启动 WS Server，生成 session id。
2. DeviceProvider 带着参数启动 App（参见上表）。
3. agent 尽早读取参数并连接；连接后立即发送 `hello { session, platform, protocolVersion, agentVersion, hasNativeModule }`。
4. Host 校验 session 和协议版本，不匹配时用 4xxx 关闭码拒绝。
5. 从启动到收到 hello，实测约 2.4–3.9s（含 bundle 加载）。Host 的连接等待超时应设在 30s 左右，超时后给出排查提示：端口、是否为 e2e 构建、Android 上的 `adb reverse` 状态。
