# Phase 6.6 spike: device state

Scripts behind findings.md "6.6 spike" (2026-11-09).

- `web-device.mjs` — offline, color scheme, viewport swap, geolocation, permissions, clipboard on Chromium (runs as is).
- `common.mts`, `android-device.mts`, `ios-device.mts`, `recheck.mts` — ran against the example app with spike-only
  backdoors (`spikeProbe`, `spikeFetch`, `spikeClipboard`, `spikeOrientation`) that were removed afterwards; they no
  longer run unchanged.
