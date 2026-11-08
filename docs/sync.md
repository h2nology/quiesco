# Synchronization

Quiesco waits for the app to be **idle** before every query and assertion and after every action, so
steps never sleep or poll. "Idle" is decided inside the app by independent trackers; the app is idle
when all of them are idle twice in a row, one macrotask apart (a timer that fires and starts a request
in the same tick does not slip through).

## Trackers

| Tracker | Busy while | Notes |
|---|---|---|
| `network` | a `fetch` / `XMLHttpRequest` is in flight | WebSockets never count (nor does the agent's own connection). `sync.ignoreUrls` excludes long polling, SSE, analytics. A `fetch` built on XHR (React Native) counts once. |
| `timer` | a `setTimeout` with a delay ≤ `sync.timerThresholdMs` (1.5 s) is pending | Longer timers (session expiry, polling every 30 s) do not block. `setInterval` only counts with `sync.countIntervals: true`. |
| `react` | React has uncommitted work: a root with pending lanes or a scheduled callback, or a pending task in React's scheduler (render work, passive effects) | Reads React's own bookkeeping through the DevTools hook — nothing in the app needs to change. |
| `idle-callback` | a `requestIdleCallback` is pending (and `InteractionManager` work on React Native versions that still have it) | |
| `native` (iOS) | a view-controller transition (navigation, modal presentation) runs, or the keyboard is moving / was just used | Reported by `@quiesco/native`; covers UIKit work invisible to JavaScript. |
| `frame-stable` | the element tree (type, testID, text, rounded position and size of every element) changed during the last `sync.stableFrames` (2) frames | The fallback for animations on the UI thread (Reanimated, native-driver `Animated`). Only sampled while a call waits. |

Turn a tracker off with `sync: { trackers: { 'frame-stable': false } }`.

How the React tracker works, and why the agent must load before React Native's renderer, is described in
[docs/spikes/02-react-idle.md](spikes/02-react-idle.md). `withQuiesco()` in `metro.config.js` takes care
of the loading order (React Native 0.88 loads its renderer before the app's entry file).

## When the app never becomes idle

A call that waits longer than `sync.timeoutMs` (10 s) fails with `SYNC_TIMEOUT`, listing what was busy:

```
App did not become idle within the 10000ms timeout. Busy:
  - network: GET https://api.example.com/todos (10012ms)
  - timer: setTimeout(poll, 1000ms), fires in 420ms
  - frame-stable: element tree changing: stable for 1/2 frames (580 frames sampled in 9960ms)
    last change: first difference at node 12: Text "Loading 41%" … → Text "Loading 42%" …
```

What to do depends on the tracker:

- **network** — a request that never ends (long polling, a stalled backend): add it to `sync.ignoreUrls`,
  or fix the backend / mock. Use `MOCK_STALL`-style knobs in your mock server to reproduce it on purpose.
- **timer** — a short timer that is re-armed forever (a polling loop with `setTimeout`, a toast that
  re-schedules itself). Raise `sync.timerThresholdMs` only if the loop is longer than the threshold;
  otherwise skip sync for that step (`{ sync: false }`) or stop the loop in e2e builds.
- **frame-stable** — something keeps moving: an endless animation (spinner, shimmer, marquee, a slow
  decorative glow) or a counter. The report names the first element that changed. If the element is
  decoration, give it a testID and list it in `sync.ignoreElements` — it and its subtree are left out of
  this check, everything else still is. Otherwise call the step with `{ sync: false }` and assert what
  you need afterwards, or disable the animation in e2e builds. If `frames sampled` is very
  low for the time waited, the UI thread is starved (an overloaded emulator), not animating.
- **react** — a render loop (a state update in an effect without a guard) never settles: a real bug.

`AGENT_TIMEOUT` is different: the agent did not answer at all, usually because the JS thread is blocked
by a long synchronous task.

## Skipping sync for one call

```ts
await this.app.tap('start-spinner', { sync: false });        // do not wait before / after
await this.app.expectVisible('spinner', { sync: false });    // assert while it spins
```

## Platform notes

The same trackers run on all three platforms. On the web the agent reconnects after a full page load and
the host waits for it transparently; with Expo Router's static output the app is considered ready after
hydration. The `native` tracker exists only on iOS. See [platform differences](platforms.md).
