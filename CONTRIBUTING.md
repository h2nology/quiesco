# Contributing

## Setup and checks

Requirements: Node.js 24+, pnpm (the version in `package.json` → `packageManager`).

```sh
pnpm install
pnpm --filter @quiesco/web exec playwright install chromium   # for the web provider tests
pnpm check          # build, lint, architecture rules, unit tests, the example's type check
```

Changes to the agent, the native module or the config plugin: also run `pnpm check:prod-strip` (or let
the `prod-strip` workflow run). End-to-end runs of the example app on all three platforms are described
in [examples/todo-app](examples/todo-app/README.md).

Tests and steps never sleep or wait a fixed time: wait for a condition (Quiesco's sync does this for
`this.app` calls).

## Documentation

`docs/` is the [Mintlify](https://mintlify.com) site <https://shift-14cc7601.mintlify.site>, in English,
Simplified Chinese and Japanese. Mintlify deploys it from `main`. Layout:

```
docs/
├── docs.json          site settings and the navigation of every language
├── index.mdx …        English pages (the source)
├── zh/index.mdx …     Chinese, same file names
├── ja/index.mdx …     Japanese, same file names
├── releasing.md       maintainers' release guide (not on the site, see .mintignore)
└── spikes/            research notes (not on the site)
```

Rules:

- **English is the source.** A pull request that changes an English page changes `zh/` and `ja/` the
  same way. If you cannot write one of the languages, say so in the pull request so a maintainer can
  translate before merging; don't merge an English change without its translations.
- **New page:** add the `.mdx` file in all three languages and list it in each language's navigation in
  `docs.json`, in the same position. A page missing in one language is a 404 on the site; the site does
  not fall back to English.
- **Headings:** every `##` heading ends with a stable id, `## Configuration {#configuration}`; the
  translations keep the same id, so links and anchors work in every language. Give a `###` heading an id
  when something links to it. Don't change an id that exists: links outside the site use it.
- **Links:** between pages `./api#configuration` (no extension; it resolves to the same language). To
  files outside `docs/`, the full GitHub URL.
- **Translating:** code, API names, config keys, error codes, commands, file paths and link targets stay
  as they are; comments inside code blocks are translated; Gherkin examples stay in English (they pair
  with step definitions). Chinese and Japanese paragraphs are not wrapped mid-sentence (a line break
  shows as a space). Terms: the glossary in `.planning/2026-11-14-release/findings.md` ("R.D.3").
- **README:** the README's introduction and quick start also appear on the site (`index.mdx`,
  `quickstart.mdx`, `native.mdx`, `runners.mdx`); change both.

Check before pushing:

```sh
pnpm docs:check              # navigation, translations keep the English structure, mint validate, broken links
pnpm docs:check --no-mint    # the first two only, offline
cd docs && npx mint@4.3.34 dev   # local preview at http://localhost:3000
```

The `docs` workflow runs `docs:check` when `docs/` changes.

## Releasing

See [docs/releasing.md](docs/releasing.md).
