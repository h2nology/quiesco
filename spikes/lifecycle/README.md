# Phase 6.5 spike: app lifecycle

Scripts behind findings.md "6.5 spike" (2026-11-09). Kept as a record; the conclusions are implemented in
`@quiesco/core` (`app.device.*`) and covered by `examples/todo-app/features/lifecycle.feature`.

- `web-visibility.mjs` — can a Playwright-driven Chromium page become hidden? (runs as is: `node web-visibility.mjs [headed]`)
- `android-lifecycle.mts`, `android-background.mts`, `ios-background.mts`, `ios-launch-url.mts` — ran against the
  example app with spike-only backdoors (`lifecycleInfo`, `spikeSuspend`) that were removed afterwards; they no
  longer run unchanged.
