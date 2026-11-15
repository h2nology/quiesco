# Issue 回复草稿（I.F，发前给 HU 看）

发布 0.2.0 之后贴。各条都以「Fixed in 0.2.0」开头。PR 合并时 `Closes #n` 会自动关闭，回复在关闭后补上。

---

## #1 Soft reset does not reset Expo Router navigation state

Fixed in 0.2.0 (#11). When the app uses Expo Router, the agent takes a snapshot of the navigation state when the app mounts, and every soft reset puts it back. You don't need to set anything up, and you can remove the `onReset` workaround. This covers stacks, tabs and nested navigators.

After each reset, Quiesco also checks that the app is back on its initial route. If something the reset can't clear navigates away again (module state, for example), the reset itself fails with `RESET_FAILED` and names both routes. Before, the scenario's first step would time out instead. For apps without Expo Router, `reset.expectVisible` in `quiesco.config` does the same check with an element.

Verified on a fresh create-expo-app (SDK 58, expo-router 58.0.31) with your layout: a scenario ends on `/students/new`, and the next one starts on `/` on web, iOS and Android.

## #2 Failure messages hide the real cause when the target is on a different screen

Fixed in 0.2.0 (#12):

- When an element exists but is not visible, the message now says why: on a screen that is not on top, hidden by an ancestor, off-screen, zero size, or clipped. It also gives the current route. Your case now reads:
  `expect visible failed after 10000ms for { id: "search" }: … an ancestor <div> is hidden (display: none or opacity: 0), e.g. a screen that is not on top (current route: /students/new)`
- The "still busy" part is only added when the app was busy for a meaningful part of the wait. A 4 ms wait no longer reads as the cause.
- Failure artifacts include `elements.json`: only nodes with a testID, label or text, with visibility, the reason when not visible, and the route.

## #3 Warn when the app under test runs a stale JS bundle

Fixed in 0.2.0 (#12):

- The connection log now says where the bundle came from, e.g. `app JS: Metro started 10:02:11, watching files` or `bundle built 09:28:20, a one-off export`.
- Quiesco warns when Metro was started with `CI` set, and when a one-off export is older than a source file in the project. The warning names the file. Test code (`features/`, `e2e/`, `*.test.ts`) does not count.
- `quiesco doctor` warns when `CI` is set in an interactive terminal.

With #5, `quiesco test` can also start Metro itself, the right way.

## #4 Add a cross-platform app.goBack()

Added in 0.2.0 (#13): `app.goBack()`, and the step `I go back` in `@quiesco/steps`.

- Android: system back. If the keyboard is open, it is closed first, so one `goBack()` always leaves the screen.
- iOS: taps the navigation bar's back button (the native header's, found through XCUITest). Without one (`headerShown: false`), it does the edge-swipe back gesture.
- Web: browser history back.

With Expo Router, `goBack()` fails with `ASSERTION_FAILED` when the route did not change, so a back that did nothing is caught where it happened. Your `goBack` helper can become `await this.app.goBack()`.

## #5 Start Metro automatically and add a quiesco build command

Added in 0.2.0 (#14):

- `quiesco test` starts `npx expo start` (with `EXPO_PUBLIC_QUIESCO=1`) when nothing answers at `devClient.metroUrl` / `apps.web.url` on this machine. It waits until Metro is ready and stops it afterwards, also on Ctrl-C. A Metro that is already running is reused. Its log goes to `artifacts/metro.log`. Use `devServer: { autoStart: false }` to turn this off, or `command` / `timeoutMs` to change how it starts.
- `quiesco build ios|android` runs prebuild with `EXPO_PUBLIC_QUIESCO=1` and the native build, and writes the app to `apps.<platform>.binaryPath`. For iOS it reads the derived data path, configuration and scheme from `binaryPath`. A Debug build is skipped when the native inputs (app config, dependencies) have not changed. `--force` rebuilds anyway.
- `quiesco init` now adds `e2e:build:ios` / `e2e:build:android` scripts.

Your four steps become `npx quiesco build ios` once, then `npx quiesco test --platform ios`.

## #6 Typed backdoors

Added in 0.2.0 (#13), both parts:

- Arguments and results take any JSON-compatible type, interfaces included. `students as never` is no longer needed.
- Typed registry through declaration merging, as you suggested:

```ts
declare module '@quiesco/agent' {
  interface Backdoors {
    'students.set': (list: Student[]) => void;
    'students.get': (id: string) => Student | null;
  }
}
```

`quiesco.backdoor(name, fn)` in the app and `this.app.backdoor(name, ...args)` in the tests are then checked for the name, the arguments and the result. If the tests' tsconfig does not include the file, use `import type {} from '../src/backdoors'`. A plain import fails at run time.

## #7 quiesco test: add --help and handle a leading --

Fixed in 0.2.0 (#10). `quiesco test --help` lists Quiesco's options, explains that other arguments go to the runner, and gives examples. `quiesco --help` points to it, and so does the missing-platform error. Quiesco reads its own options only before `--`, drops the `--` itself, and passes everything after it to the runner unchanged. `quiesco test --platform web -- --tags @debug` now works.

## #8 Generated cucumber.mjs makes single-file runs run every feature

Fixed in 0.2.0 (#10). `quiesco init` no longer writes `paths` (`features/**/*.feature` is the cucumber-js default). `quiesco test --platform ios features/x.feature` runs only that file and prints no deprecation warning. In an existing project, remove the `paths` line from `cucumber.mjs`.

## #9 Point out repeated identical failures after reset, and offer to stop early

Added in 0.2.0 (#11):

- After each soft reset, Quiesco checks that the app is back on its initial route (and on `reset.expectVisible`, if set). If not, the reset fails right away and names the route.
- `bailOnRepeatedFailure` in `quiesco.config`, default `3`: after that many scenarios in a row fail with the same error, Quiesco prints a hint with the current route and skips the rest. Set it to `false` to keep only the hint. Works with Cucumber, Jest and Vitest.

On a repro like yours (module state sends the app to `/students/new` after every reset; 6 scenarios), web now stops after 3 identical reset failures in 1.4 s.
