---
name: debug
description: This skill should be used in a Quiesco project when the user runs /quiesco:debug or says "my Quiesco test failed", "why did this scenario fail", "debug the e2e failure", "the e2e tests are red", "fix the failing feature", "this scenario is flaky", "passes alone but fails in parallel / in CI", "the app never becomes idle", or pastes a Quiesco error such as SYNC_TIMEOUT, ELEMENT_NOT_FOUND, ELEMENT_OBSCURED, MULTIPLE_MATCHES, ASSERTION_FAILED, CONNECT_TIMEOUT, AGENT_TIMEOUT, APP_ERROR or RESET_FAILED. Reads the failure evidence of the latest run (or re-runs the given tests), finds the cause, fixes test code directly and asks before changing app code, then re-runs to verify.
argument-hint: "[feature-file[:line] | test file | --tags @x | --name text] [--platform ios|android|web]"
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Agent, AskUserQuestion
---

# Debug a failing Quiesco test

Find why Quiesco tests failed, from the evidence Quiesco writes, and fix the cause — never by adding
sleeps, retries or longer timeouts.

## 1. Get the failures

A test, feature file or tag named in the user's message counts as an argument too, also when the skill was not invoked as a command.

**No arguments** — analyze the latest run already on disk:

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/debug/scripts/find-failures.mjs" [artifactsDir]
```

Run it from the project root. `artifactsDir` defaults to `artifacts`; pass `artifacts.dir` from
`quiesco.config.*` when the project changed it. The script prints, per failed scenario: its evidence
directory and files, the failed Driver call with its error message, the calls before it, and the busy
trackers. A parallel run (`--workers N`) has one directory per worker (`…-<platform>-wN`); the
script reads them together as one run. When the latest run has no failures it lists recent runs that do; analyze the most recent of
those with `--run <name>` and tell the user which run (its timestamp is in the name). When there are no
artifacts at all, ask the user for the failing command or output.

**With arguments** — re-run first, then read the evidence as above:

```sh
npx quiesco test --platform <platform> $ARGUMENTS   # minus a --platform already in it
```

- Take the platform from `--platform` in the arguments, else from the latest run's directory name
  (`<date>-<time>-<platform>`), else ask.
- Prefer the project's `e2e:*` script when the web export must be rebuilt first (`e2e:web` runs
  `expo export` before `quiesco test`); pass extra arguments after `--`.
- Pass `--runner` / `--config` as the project's scripts do for Vitest or Jest.
- Native runs take minutes; run them with `run_in_background`.

Also keep the runner's own output when available: a failure outside a Driver call (a plain `assert`, an
undefined step, a TypeScript error) appears only there, and the script says "Failed call: not recorded".

## 2. Analyze

Group failed scenarios by error. When several fail the same way (the run may stop early after
`bailOnRepeatedFailure`, default 3), analyze one representative.

For each distinct failure, launch the plugin's agent with the Agent tool,
`subagent_type: "quiesco:failure-investigator"`, giving it: the evidence directory path,
the failed call and error from the script, the platform, the feature or test file and scenario name,
the step definition / driver files involved if known, and these documentation paths (the agent cannot
resolve the plugin root itself): `${CLAUDE_PLUGIN_ROOT}/skills/debug/references/troubleshooting.md`,
`${CLAUDE_PLUGIN_ROOT}/skills/debug/references/known-issues.md`,
`${CLAUDE_PLUGIN_ROOT}/skills/quiesco-api/references/sync.md`,
`${CLAUDE_PLUGIN_ROOT}/skills/quiesco-api/references/api.md`. Launch independent investigations in parallel
(at most three). The agent reads `failure.png`, `elements.json`, `element-tree.json`, `idle-state.json`,
`device.log` and the timeline, which are too large to load here, and returns the cause, the evidence
and a proposed fix.

A failure that the error message alone explains (e.g. `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, an undefined
step, `BACKDOOR_NOT_REGISTERED` listing the registered names) does not need the agent.

## 3. Decide what kind of failure it is

| Kind | Examples | Action |
|---|---|---|
| Test code is wrong | wrong / ambiguous matcher, missing `within` / `index`, step assumes state from another scenario, wrong expected text | Fix directly |
| Config | endless request (`sync.ignoreUrls`), decorative animation (`sync.ignoreElements`), missing permission, wrong device | Fix `quiesco.config.*` directly |
| App needs a test hook | missing `testID`, a backdoor or `onReset` to clear state, an animation to disable in e2e builds | Propose the change, ask first |
| Real app bug | `APP_ERROR` from app code, a React render loop, an assertion showing wrong behavior | Report it as a bug; do not change the test to pass |
| Environment | `CONNECT_TIMEOUT`, old bundle, mixed versions, starved emulator, Metro started without `EXPO_PUBLIC_QUIESCO=1` | Run `npx quiesco doctor`, fix the setup, restart Metro / rebuild |

Error-by-error guidance: `references/troubleshooting.md`; framework issues with known workarounds:
`references/known-issues.md`; tracker-by-tracker `SYNC_TIMEOUT` fixes:
`${CLAUDE_PLUGIN_ROOT}/skills/quiesco-api/references/sync.md`.

## 4. Fix

- **Test code and `quiesco.config.*`** (features, step definitions, drivers, support files, test files):
  edit directly.
- **App code** (anything the app bundles): show the user the proposed change and the reason with
  AskUserQuestion before editing. Name each file.
- Keep fixes within the rules of the `writing-tests` skill: no sleeps, no `waitForIdle()` between
  actions, Quiesco assertions over one-shot `assert`, scenarios independent of each other.
- Never "fix" by raising `sync.timeoutMs` or a call's `timeoutMs` unless the evidence shows the app
  legitimately needs longer (e.g. a slow real backend) — say so explicitly when doing it.

## 5. Verify

Re-run only the scenarios that failed, on the same platform:

- Cucumber: `npx quiesco test --platform <p> <feature>:<line>`; find the line by grepping the feature
  files for the scenario title (the evidence directory is `<nnn>-<scenario name>`), or with
  `npx quiesco list <feature>`.
- Vitest / Jest: the test file plus the runner's name filter (`-t "<name>"`) after `--`.

After app-code changes, rebuild what the app runs before verifying: on the web re-export (the
`e2e:web` script); a Metro dev client reloads by itself; native-module or config-plugin changes need
`npx quiesco build <platform>` again.

Repeat analyze → fix → verify at most three times per failure. If it still fails, stop and report what
was tried and what the evidence shows.

## 6. Report

Per failure: the scenario, the cause in one sentence, the evidence that shows it (file and what it
shows), the fix made (or proposed and awaiting approval, or the app bug to file), and the verification
result. List every file changed, separating test code from app code.

## Additional resources

- **`scripts/find-failures.mjs`** — summary of a run's failures from the artifacts directory
  (`--run <name>` for another run, `--list-runs` to list them).
- **`references/troubleshooting.md`** — failures by symptom and error name, per platform.
- **`references/known-issues.md`** — known framework issues and their workarounds.
- **`${CLAUDE_PLUGIN_ROOT}/skills/quiesco-api/references/api.md`** — "Errors" and "Artifacts" sections:
  every error name and every evidence file.
