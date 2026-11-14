#!/usr/bin/env node
// @ts-check
/**
 * Release check (.planning/2026-11-14-release): packs every publishable package with `pnpm pack` (the
 * same packing `pnpm publish` does) and checks the tarballs before anyone publishes them.
 *
 *   node scripts/check-release.mjs [--keep <dir>]     (`pnpm release:check` runs `pnpm check` first)
 *
 * Checks, per package:
 *   - one version for all packages; dependencies on each other are that exact version (no `workspace:`);
 *   - metadata: license, author, repository (with this package's directory), homepage, bugs, engines.node,
 *     publishConfig.access public for scoped packages;
 *   - contents: README.md, LICENSE and package.json present; every main / types / bin / exports target
 *     present; no tests, test configs, tsconfig / tsbuildinfo, generator scripts or source maps whose
 *     sources are missing; no absolute local paths in any text file.
 *
 * `--keep <dir>`: leave the tarballs in <dir> (for the cold smoke test or a publish dry run).
 * Exit code: 0 all good, 1 a check failed.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keepIdx = process.argv.indexOf('--keep');
const keep = keepIdx >= 0 ? path.resolve(process.argv[keepIdx + 1] ?? '') : null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-release-'));
const packDir = keep ?? path.join(work, 'packs');
fs.mkdirSync(packDir, { recursive: true });

/** @type {string[]} */
const problems = [];
const fail = (/** @type {string} */ pkg, /** @type {string} */ msg) => problems.push(`${pkg}: ${msg}`);

/** @param {string} cmd @param {string[]} args @param {string} cwd */
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}:\n${r.stdout}${r.stderr}`);
  return r.stdout;
}

const dirs = fs
  .readdirSync(path.join(root, 'packages'))
  .map((d) => path.join(root, 'packages', d))
  .filter((d) => fs.existsSync(path.join(d, 'package.json')))
  .filter((d) => !JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).private);

/** @type {Map<string, { dir: string, version: string }>} */
const ours = new Map();
for (const dir of dirs) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  ours.set(pkg.name, { dir, version: pkg.version });
}
const versions = new Set([...ours.values()].map((p) => p.version));
if (versions.size !== 1) problems.push(`versions differ: ${[...ours].map(([n, p]) => `${n}@${p.version}`).join(', ')}`);
const version = [...versions][0];

const FORBIDDEN = [
  [/(^|\/)test\//, 'test directory'],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, 'test file'],
  [/(^|\/)vitest\.config\./, 'vitest config'],
  [/(^|\/)tsconfig[^/]*\.json$/, 'tsconfig'],
  [/\.tsbuildinfo$/, 'tsbuildinfo'],
  [/\.rb$/, 'generator script'],
  [/(^|\/)node_modules\//, 'node_modules'],
];
const TEXT = /\.(c?m?[jt]sx?|json|map|md|swift|kt|java|h|m|mm|gradle|podspec|pbxproj|xcscheme|cjs)$/;
const ABSOLUTE = /(\/Users\/|\/home\/|[A-Z]:\\\\Users\\\\)[^/\\"'\s]+/;

for (const [name, { dir }] of ours) {
  const out = run('pnpm', ['pack', '--pack-destination', packDir, '--json'], dir);
  const info = JSON.parse(out.slice(out.indexOf('{')));
  const tarball = info.filename;
  const extract = path.join(work, 'x', name.replace('/', '__'));
  fs.mkdirSync(extract, { recursive: true });
  run('tar', ['xzf', tarball, '-C', extract], root);
  const base = path.join(extract, 'package');
  /** @type {string[]} */
  const files = [];
  const walk = (/** @type {string} */ d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(path.relative(base, p).split(path.sep).join('/'));
    }
  };
  walk(base);
  const has = (/** @type {string} */ f) => files.includes(f.replace(/^\.\//, ''));
  const pkg = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));

  // Metadata.
  for (const field of ['license', 'author', 'homepage', 'description']) if (!pkg[field]) fail(name, `no "${field}"`);
  if (!pkg.engines?.node) fail(name, 'no engines.node');
  if (!pkg.bugs?.url) fail(name, 'no bugs.url');
  const rel = path.relative(root, dir).split(path.sep).join('/');
  if (pkg.repository?.directory !== rel) fail(name, `repository.directory should be "${rel}"`);
  if (name.startsWith('@') && pkg.publishConfig?.access !== 'public') fail(name, 'publishConfig.access is not "public"');

  // Dependencies on each other: the exact release version.
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
      if (String(range).startsWith('workspace:')) fail(name, `${field}.${dep} is still ${range}`);
      if (ours.has(dep) && range !== version) fail(name, `${field}.${dep} is ${range}, expected ${version}`);
    }
  }

  // Contents.
  for (const f of ['package.json', 'README.md', 'LICENSE']) if (!has(f)) fail(name, `${f} missing from the tarball`);
  /** @type {string[]} */
  const targets = [];
  for (const k of ['main', 'types', 'react-native']) if (typeof pkg[k] === 'string') targets.push(pkg[k]);
  if (typeof pkg.bin === 'string') targets.push(pkg.bin);
  else for (const b of Object.values(pkg.bin ?? {})) targets.push(String(b));
  const collect = (/** @type {unknown} */ e) => {
    if (typeof e === 'string') targets.push(e);
    else if (e && typeof e === 'object') for (const v of Object.values(e)) collect(v);
  };
  collect(pkg.exports);
  for (const t of targets) if (!t.includes('*') && !has(t)) fail(name, `entry ${t} missing from the tarball`);
  for (const f of files) {
    for (const [re, what] of FORBIDDEN) if (/** @type {RegExp} */ (re).test(f)) fail(name, `${what} in the tarball: ${f}`);
    if (!TEXT.test(f)) continue;
    const text = fs.readFileSync(path.join(base, f), 'utf8');
    const abs = ABSOLUTE.exec(text);
    if (abs) fail(name, `absolute local path in ${f}: ${abs[0]}`);
    if (f.endsWith('.map')) {
      for (const s of JSON.parse(text).sources ?? []) {
        const src = path.posix.normalize(path.posix.join(path.posix.dirname(f), s));
        if (!has(src)) fail(name, `${f} points at ${src}, which is not in the tarball`);
      }
    }
  }
  console.log(`${name}@${pkg.version}: ${files.length} files, ${(info.size ?? fs.statSync(tarball).size) / 1000} kB`);
}

fs.rmSync(path.join(work, 'x'), { recursive: true, force: true });
if (keep === null) fs.rmSync(work, { recursive: true, force: true });
else console.log(`tarballs kept in ${keep}`);

if (problems.length > 0) {
  console.error(`\nrelease check: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`\nrelease check: ${ours.size} packages at ${version} ready to publish`);
