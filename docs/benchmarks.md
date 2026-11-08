# Benchmarks

Measured with `examples/todo-app/bench/run.mts` (`pnpm bench:android` in the example app); see
requirements.md §8 (性能 / 稳定性). Numbers are from a dev client loading a development JS bundle from
Metro, so they include dev-mode overhead; release builds will be faster.

What is measured:

- **soft reset (agent)**: duration reported by the agent for `reset` (clear storage → onReset hooks →
  remount → wait for idle). Target from requirements.md §6.5: < 500 ms.
- **soft reset (host round trip)**: the same, measured on the host around the WebSocket call.
- **tap incl. sync**: `app.tap('login-button')` on the login screen with an empty email (shows a hint, no
  network), measured on the host: target resolution + sync before, the touch, and the wait for idle after.
- **full example suite**: `cucumber-js` over all example features, including APK install and app launch.

### 2026-11-07 — android, 20 iterations

- Device: Medium_Phone_API_37.0 (Android 17, API 37); dev client, Metro (dev JS bundle)
- Host: Apple M5 Pro, darwin 25.6.0, Node v24.22.1

| Metric (ms) | Mode | Median | p90 | Min | Max |
|---|---|---|---|---|---|
| soft reset (agent) | native | 195 | 198 | 104 | 215 |
| soft reset (host round trip) | native | 198 | 199 | 105 | 216 |
| tap incl. sync (host round trip) | native | 416 | 417 | 284 | 417 |
| soft reset (agent) | js | 196 | 211 | 134 | 211 |
| soft reset (host round trip) | js | 198 | 212 | 135 | 212 |
| tap incl. sync (host round trip) | js | 266 | 271 | 262 | 271 |

| Full example suite (s, incl. install + launch) | native | js |
|---|---|---|
| `cucumber-js` | 18.8 | 16 |

Notes:

- Soft reset is well under the 500 ms target in both modes.
- A native tap costs about 150 ms more than a js tap. Contributors: the 50 ms touch hold, the
  "view stopped moving" check (two native lookups one frame apart), and, after the touch, Pressability's
  `minPressDuration` timer (130 ms) that the timer tracker correctly waits for before the pressed state
  is reset. js mode calls `onPress` directly and has none of these.
- The ~260 ms floor of a js tap is mostly synchronization: the two-macrotask idle confirmation and the
  frame-stable tracker (two identical frames) before and after the action. Not optimized yet.

## Stability (requirements.md §8: 20 consecutive runs without random failures)

2026-11-07, same device and setup, `native` mode, 6 scenarios / 34 steps per run:

| Runs | Passed | Duration per run (s) |
|---|---|---|
| 20 | 20 / 20 | min 16.9, median 17.8, max 19.8 |

Per run (s): 19.8, 18.4, 16.9, 17.1, 17.3, 17.4, 17.7, 17.6, 18.6, 18.7, 17.9, 18.6, 18.0, 17.0, 17.1, 18.6,
17.4, 18.1, 18.1, 17.5.

## Phase 4 acceptance (2026-11-08)

Serial runs only (`cucumber-js --parallel` is not supported; see requirements.md §6.9). Measured with
`examples/todo-app/bench/suite.mts` (`pnpm bench:suite --platform <p> --runs <n>`): wall time around
`cucumber-js`, including install, launch and session setup, with the device already booted. Only the
measured platform's device was running.

- Host: Apple M5 Pro, darwin 25.6.0, Node v24.22.1; dev clients loading a development bundle from Metro
- iOS: iPhone 17 simulator, iOS 26.5; Android: Medium_Phone_API_37.0 (Android 17); Web: Chromium (Playwright)
- 6 scenarios / 34 steps per run, `native` action mode on iOS and Android

| Platform | Runs | Passed | Wall time per run (s) |
|---|---|---|---|
| iOS | 20 | 20 / 20 | min 15.9, median 16.1, max 16.4 |
| Android | 5 | 5 / 5 | min 17.7, median 18.5, max 18.7 |
| Web | 5 | 5 / 5 | min 6.4, median 6.4, max 6.8 |

iOS per run (s): 16.1, 16.2, 16.1, 16.1, 16.1, 16, 16, 16, 16, 16.4, 16.1, 16, 16.1, 16.2, 16, 15.9, 16.2, 16,
16, 16.2.

First run after booting the device (not included above): Android cold boot 14 s plus a 51–72 s first
run (first bundle load, system still settling); iOS simulator boot plus first run 32 s.

Notes:

- During an earlier 5-run Android series one run failed right after a cold boot (machine load ≈ 12):
  a sync timeout before tapping a button in the confirm Modal, the frame-stable tracker seeing the element
  tree change for 10 s. It did not reproduce in 18 further runs (two cold-boot series of 6 and 6 runs
  under artificial CPU load, load ≈ 15). The frame-stable timeout report now names the sampled frame count
  and the first node that changed, so a recurrence can be diagnosed from the report alone.

### Production strip check

`node scripts/check-prod-strip.mjs` (task 4.7), real builds of the example app; count of each marker in
production / e2e (control group) artifacts:

| Marker | Web export | Android release APK (R8) | iOS Release simulator .app |
|---|---|---|---|
| `getIdleState` (agent) | 0 / 4 | 0 / 1 | 0 / 1 |
| `waitForIdle` (agent) | 0 / 6 | 0 / 1 | 0 / 1 |
| `agent error: ` (agent) | 0 / 1 | 0 / 1 | 0 / 1 |
| `QuiescoNative` (native module name) | — | 0 / 3 | — |
| `QSTouchInjector` (iOS touch injector) | — | — | 0 / 38 |
| `IOHIDEventCreateDigitizerEvent` (private IOKit) | — | — | 0 / 4 |
