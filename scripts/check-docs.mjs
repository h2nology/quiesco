#!/usr/bin/env node
// @ts-check
/**
 * Documentation site check (.planning/2026-11-14-release, R.D.4). docs/ is a Mintlify project: English
 * pages at the root, translations in docs/zh/ and docs/ja/ under the same file names.
 *
 *   node scripts/check-docs.mjs [--no-mint]        (`pnpm docs:check`)
 *
 * Checks:
 *   - navigation: every page docs.json lists exists, every .mdx page is listed, and every language lists
 *     the same pages in the same order (a missing translation is a 404 on the site, not a fallback);
 *   - translations: each zh / ja page keeps the English page's structure — heading ids, link targets, MDX
 *     components, inline code and code blocks (comments may be translated) — so a change to the English
 *     page that the translation missed shows up here;
 *   - Mintlify: `mint validate` (config, navigation, content rules, a strict build) and
 *     `mint broken-links --check-anchors`, run with a pinned CLI through `pnpm dlx`.
 *
 * `--no-mint` skips the Mintlify step (no download; the first two checks take well under a second).
 * Exit code: 0 all good, 1 a check failed.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MINT = 'mint@4.3.34';
const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const config = JSON.parse(fs.readFileSync(path.join(docs, 'docs.json'), 'utf8'));
/** @type {string[]} */
const problems = [];

// ---- Navigation -------------------------------------------------------------------------------------

/** @param {unknown} node @param {string[]} out */
function pagesOf(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) for (const n of node) pagesOf(n, out);
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) if (['pages', 'groups', 'tabs', 'anchors', 'dropdowns'].includes(k)) pagesOf(v, out);
  }
  return out;
}

/** @type {{ language: string }[]} */
const languages = config.navigation.languages;
const source = languages[0].language;
const translated = languages.slice(1).map((l) => l.language);
/** @type {Map<string, string[]>} language -> page names without the language directory */
const nav = new Map();
for (const lang of languages) {
  const pages = pagesOf(lang);
  const prefix = lang.language === source ? '' : `${lang.language}/`;
  for (const p of pages) {
    if (!p.startsWith(prefix) || (prefix === '' && p.includes('/'))) problems.push(`docs.json: "${p}" is listed under ${lang.language}`);
    if (!fs.existsSync(path.join(docs, `${p}.mdx`))) problems.push(`docs.json: "${p}" has no file ${p}.mdx`);
  }
  nav.set(lang.language, pages.map((p) => p.slice(prefix.length)));
}
for (const lang of languages) {
  const dir = lang.language === source ? docs : path.join(docs, lang.language);
  const listed = new Set(nav.get(lang.language));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.mdx'))) {
    if (!listed.has(f.slice(0, -4))) problems.push(`${path.relative(docs, path.join(dir, f))} is not in the docs.json navigation`);
  }
}
const order = (nav.get(source) ?? []).join(',');
for (const lang of translated) {
  if ((nav.get(lang) ?? []).join(',') !== order) problems.push(`docs.json: the ${lang} navigation does not list the ${source} pages in the same order`);
}

// ---- Translations keep the structure ------------------------------------------------------------------

/** @param {string} text */
function structure(text) {
  /** @type {string[][]} */
  const code = [];
  /** @type {string[]} */
  const prose = [];
  /** @type {string[] | null} */
  let block = null;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      if (block) code.push(block);
      block = block ? null : [];
    } else if (block) block.push(line.replace(/(\/\/|#|\/\*).*$/, '').trimEnd());
    else prose.push(line);
  }
  const p = prose.join('\n');
  const all = (/** @type {RegExp} */ re) => [...p.matchAll(re)].map((m) => m[1]);
  return {
    'heading ids': all(/\{#([^}]+)\}/g),
    links: all(/\]\(([^)]+)\)/g).sort(),
    components: all(/<(\/?[A-Z][A-Za-z]*)/g).sort(),
    'inline code': all(/`([^`\n]+)`/g).sort(),
    'code blocks': code.map((b) => b.join('\n')),
  };
}

/** @param {string[]} a @param {string[]} b */
function onlyIn(a, b) {
  const rest = [...b];
  return a.filter((x) => {
    const i = rest.indexOf(x);
    if (i < 0) return true;
    rest.splice(i, 1);
    return false;
  });
}

for (const page of nav.get(source) ?? []) {
  const file = path.join(docs, `${page}.mdx`);
  if (!fs.existsSync(file)) continue;
  const en = structure(fs.readFileSync(file, 'utf8'));
  for (const lang of translated) {
    const tfile = path.join(docs, lang, `${page}.mdx`);
    if (!fs.existsSync(tfile)) continue; // reported above
    const tr = structure(fs.readFileSync(tfile, 'utf8'));
    for (const key of /** @type {(keyof typeof en)[]} */ (Object.keys(en))) {
      const a = en[key];
      const b = tr[key];
      if (key === 'code blocks') {
        if (a.length !== b.length) problems.push(`${lang}/${page}.mdx: ${b.length} code blocks, ${source} has ${a.length}`);
        else {
          const i = a.findIndex((x, j) => x !== b[j]);
          if (i >= 0) problems.push(`${lang}/${page}.mdx: code block ${i + 1} differs from ${source} (other than comments)`);
        }
      } else if (key === 'heading ids' ? a.join() !== b.join() : onlyIn(a, b).length + onlyIn(b, a).length > 0) {
        const missing = onlyIn(a, b);
        const extra = onlyIn(b, a);
        const what = [missing.length ? `missing ${missing.slice(0, 5).join(', ')}` : '', extra.length ? `extra ${extra.slice(0, 5).join(', ')}` : '']
          .filter(Boolean)
          .join('; ');
        problems.push(`${lang}/${page}.mdx: ${key} differ from ${source}${what ? ` (${what})` : ' (order)'}`);
      }
    }
  }
}

// ---- Mintlify -----------------------------------------------------------------------------------------

if (!process.argv.includes('--no-mint')) {
  for (const args of [['validate'], ['broken-links', '--check-anchors']]) {
    console.log(`$ mint ${args.join(' ')}`);
    const r = spawnSync('pnpm', ['--silent', 'dlx', MINT, ...args, '--telemetry', 'false'], { cwd: docs, encoding: 'utf8', env: { ...process.env, CI: 'true' } });
    // eslint-disable-next-line no-control-regex
    const out = `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    const lines = out.split('\n').filter((l) => l.trim() && !/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(l) && !/mint-cli-instructions|mint signup|mint login|Starter plan|mintlify\.site|shows the exact URL|instructions it prints/.test(l));
    console.log(lines.map((l) => `  ${l}`).join('\n'));
    if (r.status !== 0) problems.push(`mint ${args.join(' ')} failed (exit ${r.status})`);
  }
}

const pageCount = (nav.get(source) ?? []).length;
if (problems.length > 0) {
  console.error(`\ndocs check: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`\ndocs check: ${pageCount} pages in ${languages.length} languages (${languages.map((l) => l.language).join(', ')}) ok`);
