/**
 * The steps of `quiesco init` that `quiesco init --upgrade` repeats on an existing project: installing the
 * Quiesco packages at this CLI's version, app IDs in app.json, tsconfig.json and the e2e scripts. Each step
 * records what it did as an InitStep and, in a dry run, only says what it would do.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { CliContext, CliPlatform } from './context.js';
import { installedVersion, isQuiescoPackage } from './packages.js';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface PackageJson {
  name?: string;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  resolutions?: Record<string, string>;
  [key: string]: unknown;
}

export interface AppJson {
  expo?: {
    name?: string;
    slug?: string;
    scheme?: string | string[];
    plugins?: unknown[];
    ios?: { bundleIdentifier?: string; [key: string]: unknown };
    android?: { package?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
}

export interface InitStep {
  status: 'created' | 'updated' | 'skipped' | 'ran' | 'todo';
  what: string;
  note?: string;
}

/** Where steps record what they did; `dryRun`: change nothing, only record what would change. */
export interface StepLog {
  ctx: CliContext;
  steps: InitStep[];
  dryRun: boolean;
}

/** Installed into `dependencies`: the app bundles them (stubbed / excluded in production builds). */
export const RUNTIME = ['@quiesco/agent', '@quiesco/native'];
/** Installed into `devDependencies`. */
export const DEV = ['quiesco', '@quiesco/core', '@quiesco/cucumber', '@quiesco/expo-plugin', '@cucumber/cucumber'];
export const WEB_DEV = ['@quiesco/web', 'playwright'];
/** Internal packages pulled in by the ones above; only pinned when installing from tarballs. */
const TRANSITIVE = ['@quiesco/protocol'];

/** The app config files Quiesco cannot edit (JavaScript / TypeScript). */
export const DYNAMIC_APP_CONFIGS = ['app.config.js', 'app.config.ts', 'app.config.mjs', 'app.config.cjs'];

export function readJson<T>(ctx: CliContext, file: string): T | null {
  const text = ctx.readFile(file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const writeJson = (ctx: CliContext, file: string, value: unknown): void => ctx.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

export function detectPackageManager(ctx: CliContext): PackageManager {
  if (ctx.exists(path.join(ctx.cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (ctx.exists(path.join(ctx.cwd, 'yarn.lock'))) return 'yarn';
  if (ctx.exists(path.join(ctx.cwd, 'bun.lock')) || ctx.exists(path.join(ctx.cwd, 'bun.lockb'))) return 'bun';
  return 'npm';
}

/** `@quiesco/agent` → `quiesco-agent-<version>.tgz` (the file name `pnpm pack` / `npm pack` writes). */
export function findTarballs(dir: string, names: readonly string[], list: (d: string) => string[] = (d) => fs.readdirSync(d)): Map<string, string> {
  const files = list(dir).filter((f) => f.endsWith('.tgz'));
  const found = new Map<string, string>();
  for (const name of names) {
    const base = name.replace(/^@/, '').replace('/', '-');
    const match = files.find((f) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d[^/]*\\.tgz$`).test(f));
    if (match !== undefined) found.set(name, path.join(dir, match));
  }
  return found;
}

/** An `overrides:` block for pnpm-workspace.yaml (names and paths quoted: `@` starts no plain YAML scalar). */
function pnpmOverrides(pins: Record<string, string>): string {
  return `overrides:\n${Object.entries(pins).map(([n, f]) => `  ${JSON.stringify(n)}: ${JSON.stringify(f)}\n`).join('')}`;
}

export function addCommand(pm: PackageManager, dev: boolean, specs: string[]): { command: string; args: string[] } {
  switch (pm) {
    case 'pnpm':
      return { command: 'pnpm', args: ['add', ...(dev ? ['-D'] : []), ...specs] };
    case 'yarn':
      return { command: 'yarn', args: ['add', ...(dev ? ['-D'] : []), ...specs] };
    case 'bun':
      return { command: 'bun', args: ['add', ...(dev ? ['-d'] : []), ...specs] };
    case 'npm':
      return { command: 'npm', args: ['install', ...(dev ? ['--save-dev'] : []), ...specs] };
  }
}

export interface InstallOptions {
  pm: PackageManager;
  runtime: readonly string[];
  dev: readonly string[];
  /** `--packages <dir>`: install from the tarballs in it. */
  packagesDir?: string;
  skipInstall: boolean;
}

/**
 * Install `runtime` / `dev` with each Quiesco package at this CLI's version (issue #17: not whatever the
 * package manager's cached registry metadata calls latest), then read the installed versions back.
 * Returns false (after printing why) when it failed; the command should stop then.
 */
export async function installPackages(log: StepLog, o: InstallOptions): Promise<boolean> {
  const { ctx, steps } = log;
  let spec = (name: string): string => (isQuiescoPackage(name) ? `${name}@${ctx.version}` : name);
  /** The version each Quiesco package must have after the install. */
  let expected = (_name: string): string => ctx.version;
  if (o.packagesDir !== undefined) {
    const dir = path.resolve(ctx.cwd, o.packagesDir);
    const ours = [...o.runtime, ...o.dev, ...TRANSITIVE].filter(isQuiescoPackage);
    const tarballs = findTarballs(dir, ours);
    const missing = ours.filter((n) => !tarballs.has(n));
    if (missing.length > 0) {
      ctx.err(`quiesco init: no tarball for ${missing.join(', ')} in ${dir}`);
      return false;
    }
    spec = (name) => (tarballs.has(name) ? `file:${tarballs.get(name) as string}` : name);
    expected = (name) => /-(\d[^/]*)\.tgz$/.exec(tarballs.get(name) ?? '')?.[1] ?? ctx.version;
    // Their own dependencies on each other ("@quiesco/protocol": "0.0.0") must resolve to the tarballs too.
    // npm refuses an override for a package that is also a direct dependency (EOVERRIDE) and reuses the
    // directly installed tarballs for those ranges anyway: pin only the indirect ones there. pnpm and
    // yarn resolve every dependency on its own, so they need all of them pinned.
    const direct = new Set([...o.runtime, ...o.dev]);
    const pins = Object.fromEntries([...tarballs].filter(([n]) => o.pm !== 'npm' || !direct.has(n)).map(([n, f]) => [n, `file:${f}`]));
    const pinned = `installing from the tarballs in ${o.packagesDir} (${Object.keys(pins).length} indirect ${Object.keys(pins).length === 1 ? 'dependency' : 'dependencies'} pinned)`;
    if (o.pm === 'pnpm') {
      // pnpm 10+ reads overrides from pnpm-workspace.yaml only; the "pnpm" field of package.json is ignored.
      const yamlFile = path.join(ctx.cwd, 'pnpm-workspace.yaml');
      const yaml = ctx.readFile(yamlFile) ?? '';
      if (/^overrides:/m.test(yaml)) {
        ctx.err(`quiesco init: pnpm-workspace.yaml already has overrides; add these and run quiesco init again:\n${pnpmOverrides(pins)}`);
        return false;
      }
      if (!log.dryRun) ctx.writeFile(yamlFile, `${yaml}${yaml === '' || yaml.endsWith('\n') ? '' : '\n'}${pnpmOverrides(pins)}`);
      steps.push({ status: 'updated', what: 'pnpm-workspace.yaml', note: pinned });
    } else {
      const pkgFile = path.join(ctx.cwd, 'package.json');
      const current = readJson<PackageJson>(ctx, pkgFile) as PackageJson;
      if (o.pm === 'yarn') current.resolutions = { ...current.resolutions, ...pins };
      else current.overrides = { ...current.overrides, ...pins };
      if (!log.dryRun) writeJson(ctx, pkgFile, current);
      steps.push({ status: 'updated', what: 'package.json', note: pinned });
    }
  }
  /** One command per dependency group that has packages (an upgrade may have no runtime ones to change). */
  const commands = (names: (list: readonly string[]) => readonly string[]): { command: string; args: string[] }[] =>
    ([[false, o.runtime], [true, o.dev]] as const).filter(([, list]) => names(list).length > 0).map(([dev, list]) => addCommand(o.pm, dev, names(list).map(spec)));
  const installs = commands((list) => list);
  for (const cmd of installs) {
    const line = `${cmd.command} ${cmd.args.join(' ')}`;
    if (o.skipInstall || log.dryRun) {
      steps.push({ status: 'todo', what: 'install', note: line });
      continue;
    }
    ctx.out(`$ ${line}`);
    const r = await ctx.exec(cmd.command, cmd.args, { cwd: ctx.cwd });
    if (r.code !== 0) {
      ctx.err(r.stderr.trim() || r.stdout.trim());
      ctx.err(`quiesco init: \`${line}\` failed (exit ${r.code}).`);
      return false;
    }
    steps.push({ status: 'ran', what: 'install', note: line });
  }
  if (o.skipInstall || log.dryRun) return true;
  const ours = [...o.runtime, ...o.dev].filter(isQuiescoPackage);
  const wrong = ours.map((name) => ({ name, want: expected(name), got: installedVersion(ctx, name) })).filter((p) => p.got !== p.want);
  if (wrong.length > 0) {
    ctx.err(`quiesco init: the installed Quiesco packages are not the version that was asked for:`);
    for (const p of wrong) ctx.err(`  ${p.name}: ${p.got ?? 'not found in node_modules'} (wanted ${p.want})`);
    ctx.err('All Quiesco packages must have the same version as the CLI that writes the project files. The');
    ctx.err("package manager may have used stale registry metadata from its cache, or held a new release back");
    ctx.err('(pnpm minimumReleaseAge). Install them again with the version given:');
    for (const cmd of commands((list) => list.filter(isQuiescoPackage))) ctx.err(`  ${cmd.command} ${cmd.args.join(' ')}`);
    ctx.err('then run quiesco init again.');
    return false;
  }
  steps.push({ status: 'ran', what: 'versions', note: `${ours.length} Quiesco packages at ${[...new Set(ours.map(expected))].join(', ')}` });
  return true;
}

// ---- app IDs (issue #34) ----

/**
 * IDs for an app.json that has none: `com.anonymous.<slug>` (letters and digits, as Expo's prebuild derives
 * the Android package; for iOS it keeps hyphens, so the two would differ) and the slug as URL scheme.
 */
export function defaultAppIds(app: AppJson, fallbackName: string | undefined): { id: string; scheme: string } {
  const base = (app.expo?.slug ?? app.expo?.name ?? fallbackName ?? 'app').toLowerCase();
  let idPart = base.replace(/[^a-z0-9]/g, '');
  if (!/^[a-z]/.test(idPart)) idPart = `app${idPart}`;
  let scheme = base.replace(/[^a-z0-9+.-]/g, '');
  if (!/^[a-z]/.test(scheme)) scheme = `app${scheme}`;
  return { id: `com.anonymous.${idPart}`, scheme };
}

export function firstScheme(app: AppJson): string | undefined {
  const s = app.expo?.scheme;
  return Array.isArray(s) ? s[0] : s;
}

/** The app config is JavaScript / TypeScript: Quiesco cannot read or change it. */
export function dynamicAppConfig(ctx: CliContext): string | undefined {
  return DYNAMIC_APP_CONFIGS.find((f) => ctx.exists(path.join(ctx.cwd, f)));
}

/**
 * Write the IDs the platforms need into app.json when it has none (issue #34): `ios.bundleIdentifier` for
 * iOS, `android.package` and `scheme` (the dev client's deep link) for Android. Without them the build uses
 * Expo's defaults, which differ per platform and are not what quiesco.config names. Returns app.json as
 * it is now.
 */
export function ensureAppIds(log: StepLog, platforms: readonly CliPlatform[]): AppJson {
  const { ctx, steps } = log;
  const appFile = path.join(ctx.cwd, 'app.json');
  const app = readJson<AppJson>(ctx, appFile) ?? {};
  const expo = app.expo;
  if (expo === undefined || !platforms.some((p) => p !== 'web')) return app;
  const dynamic = dynamicAppConfig(ctx);
  const missing: string[] = [];
  if (platforms.includes('ios') && expo.ios?.bundleIdentifier === undefined) missing.push('ios.bundleIdentifier');
  if (platforms.includes('android') && expo.android?.package === undefined) missing.push('android.package');
  if (platforms.includes('android') && firstScheme(app) === undefined) missing.push('scheme');
  if (missing.length === 0) {
    steps.push({ status: 'skipped', what: 'app IDs', note: 'app.json has them' });
    return app;
  }
  if (dynamic !== undefined) {
    steps.push({ status: 'todo', what: 'app IDs', note: `set expo.${missing.join(', expo.')} in ${dynamic} and use the same values in quiesco.config` });
    return app;
  }
  const { id, scheme } = defaultAppIds(app, readJson<PackageJson>(ctx, path.join(ctx.cwd, 'package.json'))?.name);
  const set: string[] = [];
  if (missing.includes('ios.bundleIdentifier')) {
    expo.ios = { ...expo.ios, bundleIdentifier: id };
    set.push(`ios.bundleIdentifier "${id}"`);
  }
  if (missing.includes('android.package')) {
    expo.android = { ...expo.android, package: id };
    set.push(`android.package "${id}"`);
  }
  if (missing.includes('scheme')) {
    expo.scheme = scheme;
    set.push(`scheme "${scheme}"`);
  }
  if (!log.dryRun) writeJson(ctx, appFile, app);
  steps.push({ status: 'updated', what: 'app.json', note: `set ${set.join(', ')}: the build and quiesco.config must name the same app (change them here and in quiesco.config if you like)` });
  return app;
}

// ---- tsconfig.json (issue #21) ----

/** Step files import each other with .ts (Node's type stripping needs it): let tsc accept that. */
export function ensureTsconfig(log: StepLog): void {
  const { ctx, steps } = log;
  const tsconfigFile = path.join(ctx.cwd, 'tsconfig.json');
  const tsconfigText = ctx.readFile(tsconfigFile);
  if (tsconfigText === null) return;
  let tsconfig: { compilerOptions?: Record<string, unknown> } | null;
  try {
    tsconfig = JSON.parse(tsconfigText) as { compilerOptions?: Record<string, unknown> };
  } catch {
    tsconfig = null; // comments or trailing commas: leave the file to the user
  }
  if (tsconfig?.compilerOptions?.['allowImportingTsExtensions'] === true || /"allowImportingTsExtensions"\s*:\s*true/.test(tsconfigText)) {
    steps.push({ status: 'skipped', what: 'tsconfig.json', note: 'already allows .ts imports' });
  } else if (tsconfig === null || typeof tsconfig !== 'object' || Array.isArray(tsconfig)) {
    steps.push({ status: 'todo', what: 'tsconfig.json', note: 'add "allowImportingTsExtensions": true to compilerOptions (step files import each other with .ts)' });
  } else {
    tsconfig.compilerOptions = { ...tsconfig.compilerOptions, allowImportingTsExtensions: true };
    if (!log.dryRun) writeJson(ctx, tsconfigFile, tsconfig);
    steps.push({ status: 'updated', what: 'tsconfig.json', note: 'allowImportingTsExtensions: step files import each other with .ts' });
  }
}

// ---- scripts ----

export function e2eScripts(platforms: readonly CliPlatform[]): Record<string, string> {
  return {
    'e2e:start': 'EXPO_PUBLIC_QUIESCO=1 expo start',
    ...(platforms.includes('web') ? { 'e2e:web': 'EXPO_PUBLIC_QUIESCO=1 expo export --platform web && quiesco test --platform web' } : {}),
    ...(platforms.includes('android') ? { 'e2e:build:android': 'quiesco build android', 'e2e:android': 'quiesco test --platform android' } : {}),
    ...(platforms.includes('ios') ? { 'e2e:build:ios': 'quiesco build ios', 'e2e:ios': 'quiesco test --platform ios' } : {}),
  };
}

/** Add the e2e scripts that are missing; existing scripts of the same name are left alone. */
export function ensureScripts(log: StepLog, platforms: readonly CliPlatform[]): void {
  const { ctx, steps } = log;
  const pkgFile = path.join(ctx.cwd, 'package.json');
  const pkg = readJson<PackageJson>(ctx, pkgFile) as PackageJson;
  const scripts = { ...(pkg.scripts ?? {}) };
  const wanted = e2eScripts(platforms);
  const added = Object.keys(wanted).filter((k) => scripts[k] === undefined);
  if (added.length === 0) {
    steps.push({ status: 'skipped', what: 'scripts', note: 'the e2e scripts exist' });
    return;
  }
  for (const k of added) scripts[k] = wanted[k] as string;
  pkg.scripts = scripts;
  if (!log.dryRun) writeJson(ctx, pkgFile, pkg);
  steps.push({ status: 'updated', what: 'package.json', note: `scripts: ${added.join(', ')}` });
}

const ICON = { created: '+', updated: '~', skipped: '=', ran: '$', todo: '!' } as const;

export function printSteps(ctx: CliContext, steps: readonly InitStep[]): void {
  ctx.out('');
  for (const s of steps) ctx.out(`${ICON[s.status]} ${s.what}${s.note !== undefined ? ` — ${s.note}` : ''}`);
}
