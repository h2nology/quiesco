---
name: eas
description: This skill should be used in a Quiesco project when the user runs /quiesco:eas or asks to "run Quiesco on EAS", "run the e2e tests in EAS Workflows", "build the e2e app with EAS", "add an EAS e2e profile", "run Quiesco in CI without a Mac", "set up an e2e workflow on Expo", or says "the EAS e2e run is red" / "quiesco test fails on EAS". Adds the `e2e` build profile to eas.json, makes quiesco.config.mts use the EAS build on EAS workers, writes .eas/workflows/e2e.yml (iOS simulator on macOS, Android emulator on Linux), runs it after asking, and debugs a failed run from the evidence EAS keeps.
argument-hint: "[ios] [android]"
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Agent, AskUserQuestion
---

# Run Quiesco on EAS

EAS Build makes the e2e build of the app; EAS Workflows runs `quiesco test` against it on Expo's workers: a
macOS worker with an iOS simulator, a Linux worker with an Android emulator. The complete, tested setup is
in **`references/eas.md`**: read it first and copy its files rather than writing them from memory.

## 1. Check what is there

- Quiesco is set up: `quiesco.config.*` exists. If not, set it up first (the `/quiesco:setup` workflow);
  the local native run does not have to pass first, but the app must be an e2e-ready Expo app
  (`@quiesco/expo-plugin` in the app config, `withQuiesco()` in `metro.config.js`, `<QuiescoRoot>`).
- The EAS CLI: `eas --version` (else `npm install -g eas-cli`) and `eas whoami` (else ask the user to run
  `! eas login`: it is interactive).
- The project is linked: `extra.eas.projectId` in the app config. If not, **ask before** `eas init`: it
  creates a project on the user's Expo account.
- Platforms: those in `$ARGUMENTS` (`ios`, `android`); otherwise the native platforms in
  `quiesco.config.*`. The web needs no EAS: it runs on any CI with `npx playwright install chromium`.

## 2. The build profile

Add the `e2e` profile from the reference to `eas.json` (create the file when there is none). Merge: keep
the other profiles and `cli` settings. When an `e2e` profile already exists, compare it and change only
what is missing (`EXPO_PUBLIC_QUIESCO=1`, `ios.simulator`, `android.buildType: "apk"`,
`withoutCredentials`), saying what changed. The profile must not set `developmentClient`: the EAS build
bundles its JS and runs without Metro.

## 3. The config

Make `quiesco.config.mts` pick the EAS build when `EAS_BUILD` is set (EAS sets it on its workers), as the
reference's config does: on EAS, `binaryPath` is where the workflow copies the build (`build/e2e-ios.app`,
`build/e2e-android.apk`) and there is no `devClient`; `devices.ios.device` names a simulator the worker
has. Keep the local setup (dev client, local `binaryPath`) unchanged in the other branch. When the config
already reads the environment (`QUIESCO_IOS_DEVICE`, …), fit the switch in rather than rewriting it. Add
`build/` to `.gitignore` when it is not ignored.

## 4. The workflow

Write `.eas/workflows/e2e.yml` from the reference, with only the chosen platforms' jobs. Keep these parts,
they are what makes it work:

- `runs_on: macos-*` for iOS, `runs_on: linux-*-nested-virtualization` for Android;
- `source "$NVM_DIR/nvm.sh" && nvm install 24` in the **same** `run` as `quiesco test` (workers default to
  an older Node; each `run` is a new shell);
- on Android, the step that starts the emulator with `-no-window` and waits for `sys.boot_completed`
  (Linux workers have no display; Quiesco then uses the running emulator);
- `eas/upload_artifact` of `artifacts` with `if: ${{ always() }}` and `ignore_error: true`.

Ask which trigger the user wants (pull requests, pushes to a branch, or manual runs only) and set `on:`
accordingly; without `on:` the workflow only runs through `eas workflow:run`. Pull-request and push
triggers need the Expo project linked to the GitHub repository (project settings on expo.dev). Then:

```sh
eas workflow:validate .eas/workflows/e2e.yml
```

## 5. Run it

**Ask before running**: it uploads the project to EAS and uses the account's build and workflow minutes.
Commit first when the user wants the run tied to a commit (`eas workflow:run` uploads the working tree
either way).

```sh
eas workflow:run .eas/workflows/e2e.yml --non-interactive --json   # prints { id, url }; do not pass --wait
```

Give the user the run's URL. A run takes about 15–25 minutes (the builds are most of it). Wait in the
background, polling every minute or so until the run is no longer `NEW` / `IN_PROGRESS`:

```sh
eas workflow:view <run-id> --json        # .status, .jobs[].{key,status,id,artifacts}
eas workflow:logs <job-id> --non-interactive > job.log   # a job's full log, step by step
```

## 6. A red run

Find the failed job in `eas workflow:view`, then its log (`Step:` lines mark the steps):

- **A build job failed** — the log of `build_ios` / `build_android` has the native error. A
  missing-credentials error means the profile lost `withoutCredentials` / `ios.simulator`.
- **The test step failed with test failures** — download the evidence: the job's
  `artifacts[].downloadUrl` (valid for an hour; `eas workflow:view` gives a fresh one) is a `.tar.gz` with
  `artifacts/` inside.

  ```sh
  mkdir -p eas-artifacts && curl -sSfL "<downloadUrl>" | tar -xz -C eas-artifacts
  node "${CLAUDE_PLUGIN_ROOT}/skills/debug/scripts/find-failures.mjs" eas-artifacts/artifacts
  ```

  Then continue with the `/quiesco:debug` workflow from its step 2 (the failure-investigator agent reads
  the evidence). Re-run on EAS only after fixing; for a quick check run the same tests locally first.
- **The test step failed before any test ran:**
  - Quiesco does not start, or `node -v` in the log is below 24: Node 24 was not active in that `run`.
  - `is not installed on` / no such file `build/…`: the copy to `binaryPath` failed or the paths differ
    between the workflow and `quiesco.config.mts`.
  - `CONNECT_TIMEOUT`: the build lacks `EXPO_PUBLIC_QUIESCO=1` (check the profile's `env`), or the config
    still has `devClient` on EAS (the app then waits for Metro).
  - No simulator named …: pick one from `xcrun simctl list devices available`, run in a step of the job.
  - The emulator never booted (the boot wait timed out): check the system image path under
    `$ANDROID_HOME/system-images` and the uploaded `emulator.log` if the workflow keeps it.
- **The upload step failed** while the tests passed: `ignore_error: true` is missing.

## 7. Report

Summarize the files created or changed (`eas.json`, `quiesco.config.mts`, `.eas/workflows/e2e.yml`,
`.gitignore`), the trigger, the run's URL and result per platform, and for a red run the cause and fix.

## Additional resources

- **`references/eas.md`** — the build profile, config, workflow and what each part is for; using an EAS
  build on another machine (`eas build:download`).
- **`${CLAUDE_PLUGIN_ROOT}/skills/quiesco-api/references/config.md`** — `apps.*.binaryPath`,
  `devClient`, `devices`, `artifacts`.
- **`${CLAUDE_PLUGIN_ROOT}/skills/debug/SKILL.md`** — analyzing the downloaded evidence.
