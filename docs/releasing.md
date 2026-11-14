# Releasing

How to publish the Quiesco packages to npm. All 11 packages — the CLI `quiesco` and
`@quiesco/{agent,core,cucumber,expo-plugin,jest,native,protocol,steps,vitest,web}` — are released
together with one version number.

## Before the first release

- An npm account with two-factor authentication turned on.
- The npm organization `quiesco` (it owns the `@quiesco/*` scope): create it at
  <https://www.npmjs.com/org/create> (the free plan is enough for public packages). Add the other
  maintainers to it.
- The unscoped name `quiesco` must still be free: `npm view quiesco` answers 404 while it is.
- Every scoped package has `publishConfig.access: "public"`, so the first publish does not fail as a
  private package. `pnpm release:check` checks this.

## Releasing a version

1. **Set the version.** Change `version` in all 11 `packages/*/package.json` and `AGENT_VERSION` in
   `packages/agent/src/version.ts` (the agent reports it to the host). The packages depend on each other
   with `workspace:*`; pnpm replaces that with the exact version when it packs.

2. **Check.** On a clean, up-to-date `main`:

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter @quiesco/web exec playwright install chromium   # for the web provider tests
   pnpm release:check
   ```

   `release:check` runs `pnpm check` (build, lint, architecture rules, unit tests, the example's type
   check) and then packs every package and checks the tarballs: one version everywhere (including
   `AGENT_VERSION`), no `workspace:` left, metadata, entry files present, README and LICENSE present, no
   tests or build leftovers, source maps whose sources are in the package, no absolute local paths.

   Before a release that changes the agent, the native module or the config plugin, also run
   `pnpm check:prod-strip` (builds the example app in production and e2e mode and scans the output; it
   takes a while) or check that the `prod-strip` workflow passed on `main`.

3. **Smoke test the tarballs** (recommended for a release with user-facing changes):

   ```sh
   node scripts/check-release.mjs --keep /tmp/quiesco-packs
   ```

   Install them into a fresh `npx create-expo-app@latest` project with
   `node <this repository>/packages/cli/dist/bin.js init --packages /tmp/quiesco-packs` and follow the
   README quick start on the platforms the release touches.

4. **Commit** the version change: `chore(release): 0.2.0`.

5. **Publish:**

   ```sh
   npm login
   pnpm -r publish --dry-run     # lists what would be published
   pnpm -r publish
   ```

   pnpm publishes the packages in dependency order (`@quiesco/protocol` first) and skips any package
   whose version is already on npm. It refuses to publish from a branch other than `main` or from a
   working tree with changes. If npm asks for a one-time password, pass it with `--otp <code>`; when
   the code expires part way through, run the same command again with a new one — the packages already
   published are skipped.

6. **Tag the release:**

   ```sh
   git tag v0.2.0
   git push origin main v0.2.0
   ```

7. **Verify** from npm:

   ```sh
   npm view quiesco version
   npm view @quiesco/core version
   ```

   Then, in a fresh Expo app, `npx quiesco@0.2.0 init` and the README quick start for web.

## When something goes wrong

- **Part of the packages were published.** Fix the cause and run `pnpm -r publish` again; it publishes
  only the missing ones. Do not change the version for that.
- **A broken version, within 72 hours.** `npm unpublish <name>@<version>` removes it. npm refuses when
  another package on the registry depends on it, so remove the dependents first — the reverse of the
  publish order:

  1. `quiesco`, `@quiesco/steps`, `@quiesco/vitest`, `@quiesco/jest`, `@quiesco/web`
  2. `@quiesco/cucumber`
  3. `@quiesco/core`, `@quiesco/agent`
  4. `@quiesco/protocol`, `@quiesco/native`, `@quiesco/expo-plugin`

  A version number that was published can never be used again, even after unpublishing: release the
  fix as the next patch version. Unpublishing every version of a package also blocks its name for
  24 hours.
- **A broken version, after 72 hours** (or when unpublishing is refused). Release a fixed patch version,
  then mark the broken one so installs print a warning:

  ```sh
  npm deprecate "quiesco@0.2.0" "Broken: <what>. Use 0.2.1."
  npm deprecate "@quiesco/core@0.2.0" "Broken: <what>. Use 0.2.1."
  ```

  Deprecate every package of that version, not only the broken one, so nobody installs a mixed set.
  `npm deprecate "<name>@<version>" ""` takes the warning back.
- **A wrong `latest`.** `npm dist-tag add <name>@<good version> latest` points `latest` back, per
  package.

## Not set up (yet)

- Changesets or another changelog tool: versions are bumped by hand, all packages together.
- Publishing from CI with npm provenance (`--provenance` needs a CI identity such as GitHub Actions).
