# Quiesco plugin for Claude Code

Helps Claude set up, write and debug [Quiesco](https://github.com/h2nology/quiesco) e2e tests in an Expo
app.

| Component | Kind | What it does |
|---|---|---|
| `/quiesco:setup [web] [ios] [android]` | skill (slash command) | Sets Quiesco up in an Expo project: `quiesco init`, `<QuiescoRoot>`, testIDs, Playwright / native builds, `quiesco doctor` until it passes, the first run. Asks which platforms when none are given. |
| `/quiesco:debug [tests] [--platform p]` | skill (slash command) | Without arguments: analyzes the failures of the latest run in `artifacts/`. With arguments: re-runs those tests first. Fixes test code and config directly, asks before changing app code, re-runs to verify. |
| `quiesco-api` | skill (automatic) | The Driver API, matchers, in-app API, configuration, synchronization, platform differences. Loaded when Claude works on Quiesco code. |
| `writing-tests` | skill (automatic) | Business-language Gherkin, step definitions, the driver pattern, testIDs, tags, verifying a new test. Loaded when Claude writes or edits e2e tests. |
| `failure-investigator` | agent | Reads a failed scenario's evidence (screenshot, elements, element tree, idle state, logs, timeline) and returns the cause and a fix. Used by `/quiesco:debug`, and on its own when a run fails. |

Requirements: the project's own Quiesco installation (Node.js 24+, an Expo SDK 55+ app). The plugin
calls the `quiesco` CLI through `npx`; it has no hooks and no MCP server.

## Try it locally

```sh
claude --plugin-dir /path/to/quiesco/plugin
```

Then, in an Expo app: `/quiesco:setup web`, ask "write a scenario for adding a todo", or run
`/quiesco:debug` after a failing `quiesco test`.

## Maintaining

The `references/` directories are generated from `docs/*.mdx` — do not edit them by hand:

```sh
pnpm plugin:refs                         # regenerate after changing the docs
node scripts/build-plugin-refs.mjs --check   # part of pnpm docs:check and the docs workflow
```

Which pages go to which skill is the `PAGES` table in `scripts/build-plugin-refs.mjs`. The plugin's
`version` in `.claude-plugin/plugin.json` follows the Quiesco release version.
