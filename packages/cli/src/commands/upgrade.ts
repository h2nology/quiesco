/**
 * `quiesco init --upgrade [--dry-run] [--platforms …] [--packages <dir>] [--skip-install]` (issues #34, #35):
 * bring a project set up by an older `quiesco init` to this version. Installs every Quiesco package at this
 * CLI's version (`npx quiesco@latest init --upgrade` upgrades), then fixes what older inits wrote and the
 * current one does not: the `paths` line in the cucumber config (#8), tsconfig's allowImportingTsExtensions
 * (#21), app IDs and the config's TODO placeholders (#34), missing e2e scripts, <QuiescoRoot> (#20).
 *
 * Only changes it can make safely; anything else is listed with what to do. Running it again changes
 * nothing. `--dry-run` lists the changes without making them.
 *
 * With `appDir` (or `--app-dir`, issue #54) the app's packages (agent, native, expo-plugin) and files
 * (app.json, <QuiescoRoot>) are upgraded in the app's directory, the rest in the working directory.
 */
import path from 'node:path';

import type { QuiescoConfig } from '@quiesco/core';
import { loadConfig } from '@quiesco/core';

import { APP_DIR_OPTION, appContext } from '../app-dir.js';
import type { CliContext, CliPlatform } from '../context.js';
import { PLATFORMS, takeFlag, takeOption } from '../context.js';
import { installedVersion, isQuiescoPackage } from '../packages.js';
import { entryFile, registeredRoot, rootSourceFiles, wrapRegisteredRoot } from '../project.js';
import type { AppJson, InitStep, PackageJson, StepLog } from '../setup-steps.js';
import { DEV, RUNTIME, WEB_DEV, detectPackageManager, ensureAppIds, ensureScripts, ensureTsconfig, firstScheme, installPackages, printSteps, readJson } from '../setup-steps.js';

export interface UpgradeDeps {
  loadConfig: (cwd: string) => Promise<QuiescoConfig>;
}

export const defaultUpgradeDeps: UpgradeDeps = {
  loadConfig: async (cwd) => (await loadConfig({ cwd })).config,
};

const CONFIG_FILES = ['quiesco.config.mts', 'quiesco.config.ts', 'quiesco.config.mjs', 'quiesco.config.js'];
const CUCUMBER_FILES = ['cucumber.mjs', 'cucumber.js', 'cucumber.cjs', 'cucumber.json', 'cucumber.yaml', 'cucumber.yml'];
/** The line 0.1.x wrote into cucumber.mjs (issue #8). */
const OLD_PATHS_LINE = /^[ \t]*paths:[ \t]*\[[ \t]*['"]features\/\*\*\/\*\.feature['"][ \t]*\],?[ \t]*\r?\n/m;

/** The app's own packages, installed in the app when the tests are elsewhere (appDir, issue #54). */
const APP_PACKAGES = [...RUNTIME, '@quiesco/expo-plugin'];

/** Quiesco packages to install: the `needed` ones and every other one the project already has. */
function packagesToInstall(pkg: PackageJson, needed: readonly string[]): { runtime: string[]; dev: string[] } {
  const present = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].filter(isQuiescoPackage);
  const all = [...new Set([...needed.filter(isQuiescoPackage), ...present])];
  // Keep each package in the group it is in; new ones go where init puts them.
  const isRuntime = (n: string): boolean => pkg.dependencies?.[n] !== undefined || (pkg.devDependencies?.[n] === undefined && RUNTIME.includes(n));
  return { runtime: all.filter(isRuntime), dev: all.filter((n) => !isRuntime(n)) };
}

function fixCucumberPaths(log: StepLog): void {
  const { ctx, steps } = log;
  const rel = CUCUMBER_FILES.find((f) => ctx.exists(path.join(ctx.cwd, f)));
  if (rel === undefined) return;
  const file = path.join(ctx.cwd, rel);
  const text = ctx.readFile(file) ?? '';
  if (OLD_PATHS_LINE.test(text)) {
    if (!log.dryRun) ctx.writeFile(file, text.replace(OLD_PATHS_LINE, ''));
    steps.push({ status: 'updated', what: rel, note: "removed paths: ['features/**/*.feature'] (the default; with it, quiesco test <file> ran every feature)" });
  } else if (/\bpaths\b["']?\s*:/.test(text)) {
    steps.push({ status: 'todo', what: rel, note: 'sets paths: cucumber-js adds them to the files given on the command line, so quiesco test <file> runs them all; remove it unless you need it' });
  } else {
    steps.push({ status: 'skipped', what: rel, note: 'no paths' });
  }
}

const PLACEHOLDERS: readonly { todo: string; key: string; value: (app: AppJson) => string | undefined }[] = [
  { todo: 'expo.ios.bundleIdentifier', key: 'bundleId', value: (a) => a.expo?.ios?.bundleIdentifier },
  { todo: 'expo.android.package', key: 'package', value: (a) => a.expo?.android?.package },
  { todo: 'expo.scheme', key: 'scheme', value: (a) => firstScheme(a) },
];

/** Replace the placeholders older inits wrote (`'com.example.app', // TODO: expo.android.package`) with app.json's values. */
function fixConfigPlaceholders(log: StepLog, app: AppJson): void {
  const { ctx, steps } = log;
  const rel = CONFIG_FILES.find((f) => ctx.exists(path.join(ctx.cwd, f)));
  if (rel === undefined) return;
  const file = path.join(ctx.cwd, rel);
  const text = ctx.readFile(file) ?? '';
  const replaced: string[] = [];
  const left: string[] = [];
  const next = text
    .split('\n')
    .map((line) => {
      const p = PLACEHOLDERS.find((x) => line.includes(`// TODO: ${x.todo}`));
      if (p === undefined) return line;
      const value = p.value(app);
      const keyed = new RegExp(`(\\b${p.key}:\\s*)'[^']*'`);
      if (value === undefined || !keyed.test(line)) {
        left.push(p.todo);
        return line;
      }
      replaced.push(`${p.key} '${value}'`);
      return line.replace(keyed, `$1'${value.replace(/'/g, "\\'")}'`).replace(new RegExp(`\\s*// TODO: ${p.todo.replace(/\./g, '\\.')}`), '');
    })
    .join('\n');
  if (replaced.length > 0) {
    if (!log.dryRun) ctx.writeFile(file, next);
    steps.push({ status: 'updated', what: rel, note: `placeholders replaced with app.json's values: ${replaced.join(', ')}` });
  }
  if (left.length > 0) steps.push({ status: 'todo', what: rel, note: `placeholders left (TODO: ${left.join(', ')}): set them to the values your app config uses` });
  if (replaced.length === 0 && left.length === 0) steps.push({ status: 'skipped', what: rel, note: 'no placeholders' });
}

/** <QuiescoRoot> around the component of registerRootComponent(App) (issue #20); other entries are listed. */
function ensureRoot(log: StepLog): void {
  const { ctx, steps } = log;
  const main = readJson<PackageJson>(ctx, path.join(ctx.cwd, 'package.json'))?.main;
  if (rootSourceFiles(ctx, main).some((f) => (ctx.readFile(f) ?? '').includes('QuiescoRoot'))) {
    steps.push({ status: 'skipped', what: '<QuiescoRoot>', note: 'the app uses it' });
    return;
  }
  const entry = entryFile(ctx, main);
  const src = entry === null ? null : ctx.readFile(entry);
  const wrapped = entry === null || src === null ? null : wrapRegisteredRoot(ctx, entry, src);
  if (entry === null || src === null || wrapped === null) {
    steps.push({ status: 'todo', what: '<QuiescoRoot>', note: "wrap the root layout in <QuiescoRoot> (import { QuiescoRoot } from '@quiesco/agent'): the app connects to Quiesco from it" });
    return;
  }
  if (!log.dryRun) ctx.writeFile(entry, wrapped);
  steps.push({ status: 'updated', what: path.basename(entry), note: `wrapped ${registeredRoot(ctx, entry, src)?.name ?? 'the root component'} in <QuiescoRoot>` });
}

export async function upgradeCommand(args: readonly string[], ctx: CliContext, deps: UpgradeDeps = defaultUpgradeDeps): Promise<number> {
  let rest = [...args];
  const platformsOpt = takeOption(rest, '--platforms');
  rest = platformsOpt.rest;
  const packagesOpt = takeOption(rest, '--packages');
  rest = packagesOpt.rest;
  const skipInstall = takeFlag(rest, '--skip-install');
  rest = skipInstall.rest;
  const dryRun = takeFlag(rest, '--dry-run');
  rest = dryRun.rest;
  const appDirOpt = takeOption(rest, APP_DIR_OPTION);
  rest = appDirOpt.rest;
  if (rest.length > 0) {
    ctx.err(`quiesco init --upgrade: unknown arguments ${rest.join(' ')}`);
    return 2;
  }
  let config: QuiescoConfig | null = null;
  let configError = '';
  try {
    config = await deps.loadConfig(ctx.cwd);
  } catch (e) {
    configError = (e as Error).message.split('\n')[0] ?? '';
  }
  const app = appContext(ctx, config, appDirOpt.value);
  const separate = app !== ctx;
  const pkg = readJson<PackageJson>(app, path.join(app.cwd, 'package.json'));
  if (pkg === null || (pkg.dependencies?.['expo'] === undefined && pkg.devDependencies?.['expo'] === undefined)) {
    ctx.err(`quiesco init --upgrade: ${app.cwd} is not an Expo project (no expo dependency in package.json).${separate ? '' : ' Tests in a package of their own: set appDir in quiesco.config or pass --app-dir.'}`);
    return 1;
  }
  let platforms: CliPlatform[];
  if (platformsOpt.value !== undefined) {
    const bad = platformsOpt.value.split(',').filter((p) => !(PLATFORMS as readonly string[]).includes(p));
    if (bad.length > 0) {
      ctx.err(`quiesco init --upgrade: unknown platform ${bad.join(', ')}`);
      return 2;
    }
    platforms = platformsOpt.value.split(',') as CliPlatform[];
  } else if (config !== null) {
    platforms = PLATFORMS.filter((p) => config.apps[p] !== undefined);
  } else {
    ctx.err(`quiesco init --upgrade: cannot read quiesco.config (${configError}).`);
    ctx.err('Run quiesco init for a new setup, or name the platforms: quiesco init --upgrade --platforms ios,android,web');
    return 1;
  }

  const steps: InitStep[] = [];
  const log: StepLog = { ctx, steps, dryRun: dryRun.present };
  // The app's steps; the same as `log` unless the app is elsewhere.
  const appLog: StepLog = { ...log, ctx: app };

  // 1. Every Quiesco package at this CLI's version: one project, or the app's in the app and the rest here.
  const needed = [...RUNTIME, ...DEV, ...(platforms.includes('web') ? WEB_DEV : [])];
  const testPkg = separate ? readJson<PackageJson>(ctx, path.join(ctx.cwd, 'package.json')) : null;
  if (separate && testPkg === null) {
    ctx.err(`quiesco init --upgrade: no package.json in ${ctx.cwd} (the test project).`);
    return 1;
  }
  const sets: { log: StepLog; packages: { runtime: string[]; dev: string[] } }[] = separate
    ? [
        { log: appLog, packages: packagesToInstall(pkg, APP_PACKAGES) },
        { log, packages: packagesToInstall(testPkg as PackageJson, needed.filter((n) => !APP_PACKAGES.includes(n))) },
      ]
    : [{ log, packages: packagesToInstall(pkg, needed) }];
  for (const set of sets) {
    const { runtime, dev } = set.packages;
    const where = separate ? ` in ${path.relative(ctx.cwd, set.log.ctx.cwd) || '.'}` : '';
    const current = [...runtime, ...dev].map((n) => installedVersion(set.log.ctx, n));
    if (packagesOpt.value === undefined && current.every((v) => v === ctx.version)) {
      steps.push({ status: 'skipped', what: 'versions', note: `${current.length} Quiesco packages at ${ctx.version}${where}` });
      continue;
    }
    const ok = await installPackages(set.log, {
      pm: detectPackageManager(set.log.ctx),
      runtime,
      dev,
      ...(packagesOpt.value !== undefined ? { packagesDir: path.resolve(ctx.cwd, packagesOpt.value) } : {}),
      skipInstall: skipInstall.present,
    });
    if (!ok) return 1;
  }

  // 2. What older inits wrote: the test setup here, app.json and <QuiescoRoot> in the app.
  fixCucumberPaths(log);
  ensureTsconfig(log);
  const appJson = ensureAppIds(appLog, platforms);
  fixConfigPlaceholders(log, appJson);
  ensureScripts(log, platforms);
  ensureRoot(appLog);

  printSteps(ctx, steps);
  ctx.out('');
  if (dryRun.present) ctx.out('Dry run: nothing was changed. Run quiesco init --upgrade without --dry-run to make these changes.');
  else ctx.out(`Upgraded to Quiesco ${ctx.version}${steps.some((s) => s.status === 'todo') ? '; the lines marked ! need you' : ''}. Check the setup with: npx quiesco doctor`);
  return 0;
}
