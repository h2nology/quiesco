# Parallel runs

Quiesco runs tests on several devices at once: every **worker** of the test runner gets a device (or a
browser), a Quiesco server port and an artifacts directory of its own. The same features run unchanged.

```sh
npx quiesco test --platform ios --workers 2                    # cucumber-js --parallel 2
npx quiesco test --platform android --runner jest --workers 2  # jest --maxWorkers 2
npx quiesco test --platform web --runner vitest --workers 3    # vitest --fileParallelism --maxWorkers 3
```

The runners' own flags work too: `cucumber-js --parallel 2`, `jest --maxWorkers 2`, or
`quiesco({ workers: 2 })` / `vitest --fileParallelism --maxWorkers 2` for Vitest.

## Which device each worker uses

Parallel workers split one suite between devices to finish sooner, so every worker gets **the same model
and OS version**: worker 0 uses the device your config picks, and the others get copies of it.

| | worker 0 | worker N > 0 |
|---|---|---|
| iOS | the simulator from `devices.ios` (`udid`, or `device` + `os`, or the booted one) | `"<that name> (Quiesco N)"`, same device type and runtime; created with `simctl create` on first use and kept |
| Android | the device from `devices.android` (`serial`, or the emulator of `avd`) | its own AVD `<avd>_quiesco_N`, a copy of the base AVD's `config.ini` (same hardware and system image); created on first use and kept; booted writable and cold |
| Web | a browser | a browser of its own (separate profile, storage and cookies) |

- To pick the model, set the base device as usual (`devices.ios.device` / `os`, `devices.android.avd`);
  the example app reads `QUIESCO_IOS_DEVICE`, `QUIESCO_IOS_OS` and `QUIESCO_AVD`. A different base gets its
  own set of worker devices.
- To name every worker's device yourself, list them: `devices.ios.udids: [...]`,
  `devices.android.serials: [...]` (worker N uses entry N). Quiesco warns when they are different models or
  OS versions: a scenario would pass on one worker and fail on another.
- **Running the suite on several models** (a device matrix) is a different thing: run it once per model,
  e.g. a CI job matrix over `QUIESCO_IOS_DEVICE`, each run with its own workers.
- Without `binaryPath` (a dev client you installed by hand), workers install the app the base device has:
  the base device must be booted (Android) or have the app installed (iOS).
- Each Android worker has its own AVD because an AVD can only run several times at once when every
  instance is read-only, which a writable emulator you already have open rules out.
- `npx quiesco devices` lists the simulators and AVDs Quiesco created; `npx quiesco devices --prune` shuts
  them down and deletes them (the next parallel run creates them again). Your own devices are never touched.

## Per-worker resources in your config

The config can be a function of the worker:

```ts
// quiesco.config.ts
export default defineConfig(({ workerIndex, workerCount }) => ({
  apps: { android: { package: 'com.example.app', reversePorts: [3001 + workerIndex] } },
  // …
}));
```

Quiesco itself gives worker N the server port `server.port + N` (default 7357 + N) and writes its
artifacts to `artifacts/<date-time>-<platform>-wN/`. In the app, `quiesco.workerIndex()` returns the
worker it is connected to (`null` before the first connection and in production), e.g. to talk to that
worker's mock backend; the example app does this in `src/e2e.ts`, and its mock backend runs once per worker
(`features/support/mock-server.ts`, `e2e/jest/global-setup.mjs`, `e2e/vitest/mock-server.setup.ts`).

Scenarios must not depend on each other: each worker runs its own share of them in its own order. A
scenario that needs a state (a granted permission, a signed-in user) sets it up in its `Given` steps.

## How many workers

Each worker is a full device. On a 15-core Mac, two iOS simulators or two Android emulators run well; with
more devices than the machine can carry, Android starts showing "<app> isn't responding" dialogs (often for
System UI). Quiesco answers another app's dialog with **Wait** before each scenario and when an action finds
its element covered, and warns with the load average; when you see that warning, run fewer workers. A
dialog for the app under test is left alone: the app itself hung, and the test fails.

## Runners

- **cucumber-js**: `--parallel N` runs N worker threads; each has its own session.
- **Jest**: `maxWorkers: N` (the example reads `QUIESCO_WORKERS`). Every worker process has its own session.
  Jest ends workers without waiting for asynchronous cleanup, so Quiesco closes the session when Jest asks
  the worker to end and kills what is left synchronously; `globalTeardown` (the preset's, or yours calling
  `@quiesco/jest/teardown`) sweeps anything a worker could not. Jest may still run a fast suite in band
  (one process): that is worker 0 alone.
- **Vitest**: `quiesco({ workers: N })` from `@quiesco/vitest/config` (`fileParallelism`, `maxWorkers`,
  `isolate: false`): every worker keeps its session across the files it runs.

Measurements: [benchmarks.md](benchmarks.md#phase-612-parallel-runs).
