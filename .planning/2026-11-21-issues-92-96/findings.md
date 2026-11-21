# Findings: issues #92–#96

> issue 正文是外部输入，下面只是摘要。

## #92 iOS 首个 Face ID 弹窗
- 模拟器开机后第一个 "Face Not Recognized" 弹窗不在 SpringBoard `/screen`，只在 `/elements?bundleId=com.apple.LocalAuthenticationUIService`；之后的弹窗两边都有。
- 代码：`packages/core/src/devices/ios.ts:213` `OTHER_APPS = ['com.apple.SafariViewService', 'com.apple.mobilesafari']`；`:762` systemNodes 依次读；`:792` 按节点 app 重读。
- 报告者本地补丁加进 OTHER_APPS，重启后 2/2 通过。

## #93 native-module tracker 等满 2 s
- 打开原生对话框的调用（`RNCDatePicker.open`、`ExpoLocation.requestForegroundPermissionsAsync`）一直 pending 到测试回答，tracker 计 busy 到 `thresholdMs`（默认 2 s）⇒ Android 上每次多 ~2 s。iOS 日期选择是 inline，无差异。
- 代码：`packages/agent/src/sync/native-module.ts`：`counting()` 过滤 threshold + ignore（字符串子串 / RegExp），`describeBusy()` 已有 `Module.method() Nms`。
- timeline：`packages/core/src/timeline.ts:103,106` `wait for idle` 事件只有时长，无 busy 信息。`wait-for-idle.ts:95` 已经收集每个 tracker 的 busy 描述。
- issue 建议：1 失焦不计（Android Dialog 不改 AppState，不可靠）；2 默认 ignore 清单；3 timeline 写 busy 调用名。

## #94 tracker 默认关，竞态静默
- 默认关时 `await AsyncStorage.setItem` 期间所有 tracker idle，动作返回过早（#67），后面才失败，证据里无线索。Android 1/5。开 tracker 后 5×24/24。
- 两个开关：Metro `withQuiesco(config, { nativeModules: true })`（`wrap`）+ config `sync.trackers['native-module']`。
- `configure({enabled:false})` 时 `pending.clear()`，不记录 ⇒ 需要改为「记录但不计」。
- 建议：包裹时默认开或 doctor 警告；关时也记录 pending，写进 idle-state.json / timeline。

## #95 init --upgrade
- `packages/cli/src/setup-steps.ts:124` installPackages 用 `${name}@${version}`，npm 默认存 `^`。
- `upgrade.ts:212` 调 `ensureScripts`（`setup-steps.ts:320`），缺哪个加哪个 ⇒ 用户删掉的 e2e:* 被加回。
- 修：现有 spec 精确 ⇒ exact 参数；upgrade 不加 scripts。

## #96 doctor app IDs 与 app.config.ts
- `doctor.ts:227` `DYNAMIC_APP_CONFIGS`；有动态 config 就 warn "cannot compare the app IDs"。plugins 检查（`doctor.ts:127`）同样只 warn。
- 建议 `npx expo config --json --type public`（~0.6 s），失败回退 warn。需确认 public 输出是否含 plugins。
