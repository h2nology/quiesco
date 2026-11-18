#!/usr/bin/env node
// @ts-check
/**
 * Claude Code plugin references. The plugin (plugin/) ships the English documentation pages its skills
 * need as plain Markdown under plugin/skills/<skill>/references/, generated from docs/*.mdx so that the
 * plugin never drifts from the docs.
 *
 *   node scripts/build-plugin-refs.mjs           write the references
 *   node scripts/build-plugin-refs.mjs --check   exit 1 if a reference is missing or out of date
 *
 * The conversion: frontmatter becomes a "# title" heading and a description line; <Note> / <Warning>
 * become block quotes; <Steps> / <Step title> become numbered "### Step" headings; a link to another page
 * points at that page's reference when the plugin ships it, at the documentation site otherwise. Code
 * blocks are copied as they are.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const skills = path.join(root, 'plugin', 'skills');
const SITE = 'https://shift-14cc7601.mintlify.site';

/** skill -> the pages its references/ holds */
const PAGES = {
  'quiesco-api': ['api', 'sync', 'platforms', 'parallel', 'runners'],
  'writing-tests': ['steps', 'driver-pattern'],
  setup: ['quickstart', 'native', 'cli'],
  debug: ['troubleshooting'],
};

/** page -> skill */
const owner = new Map(Object.entries(PAGES).flatMap(([skill, pages]) => pages.map((p) => [p, skill])));

/** @param {string} page @param {string} fromSkill */
function linkTarget(page, fromSkill) {
  const skill = owner.get(page);
  if (!skill) return `${SITE}/${page}`;
  return skill === fromSkill ? `./${page}.md` : `../../${skill}/references/${page}.md`;
}

/** @param {string} source @param {string} page @param {string} skill */
export function convert(source, page, skill) {
  let text = source.replace(/\r\n/g, '\n');
  /** @type {string[]} */
  const head = [];
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (fm) {
    text = text.slice(fm[0].length);
    const field = (/** @type {string} */ k) => new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, 'm').exec(fm[1])?.[1];
    const title = field('title');
    const description = field('description');
    if (title) head.push(`# ${title}`, '');
    if (description) head.push(description, '');
  }

  const out = [];
  let fence = false;
  let quote = false;
  /** Inside a <CodeGroup> (one tab per package manager): only the npm tab is kept, as a plain code block. */
  let group = false;
  let skip = false;
  let step = 0;
  let stepIndent = 0;
  for (const raw of text.split('\n')) {
    let line = raw;
    if (stepIndent && line.startsWith(' '.repeat(stepIndent))) line = line.slice(stepIndent);
    else if (stepIndent) line = line.replace(/^\s+/, '');
    const trimmed = line.trim();

    if (trimmed === '<CodeGroup>' || trimmed === '</CodeGroup>') {
      group = trimmed === '<CodeGroup>';
      continue;
    }
    if (/^(```|~~~)/.test(trimmed)) {
      fence = !fence;
      if (group && fence) {
        const [lang = '', tab = ''] = trimmed.slice(3).trim().split(/\s+/);
        skip = tab !== 'npm';
        line = line.slice(0, line.indexOf(trimmed)) + trimmed.slice(0, 3) + lang;
      }
      if (!skip) out.push(quote ? `> ${line}` : line);
      if (!fence) skip = false;
      continue;
    }
    if (skip) continue;
    if (fence) {
      out.push(quote ? `> ${line}` : line);
      continue;
    }

    const open = /^<(Note|Warning|Tip|Info)>$/.exec(trimmed);
    if (open) {
      quote = true;
      out.push(`> **${open[1]}:**`, '>');
      continue;
    }
    if (/^<\/(Note|Warning|Tip|Info)>$/.test(trimmed)) {
      quote = false;
      continue;
    }
    if (trimmed === '<Steps>' || trimmed === '</Steps>') {
      step = 0;
      continue;
    }
    const s = /^(\s*)<Step title="(.*)">$/.exec(raw);
    if (s) {
      step += 1;
      stepIndent = s[1].length + 2;
      out.push(`### Step ${step}: ${s[2]}`, '');
      continue;
    }
    if (trimmed === '</Step>') {
      stepIndent = 0;
      out.push('');
      continue;
    }

    line = line.replace(/\]\(\.\/([a-z0-9-]+)(#[^)]*)?\)/g, (_, p, anchor = '') => `](${linkTarget(p, skill)}${anchor})`);
    out.push(quote ? (line ? `> ${line}` : '>') : line);
  }

  const body = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return `<!-- Generated from docs/${page}.mdx by scripts/build-plugin-refs.mjs — do not edit. -->\n\n${head.join('\n')}${body}\n`;
}

const check = process.argv.includes('--check');
const problems = [];
for (const [skill, pages] of Object.entries(PAGES)) {
  const dir = path.join(skills, skill, 'references');
  for (const page of pages) {
    const want = convert(fs.readFileSync(path.join(docs, `${page}.mdx`), 'utf8'), page, skill);
    const file = path.join(dir, `${page}.md`);
    const rel = path.relative(root, file);
    if (check) {
      const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (have !== want) problems.push(`${rel} is ${have === null ? 'missing' : 'out of date'}`);
    } else {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, want);
      console.log(`wrote ${rel}`);
    }
  }
}
if (problems.length) {
  for (const p of problems) console.error(p);
  console.error('Run `node scripts/build-plugin-refs.mjs` to regenerate the plugin references.');
  process.exit(1);
}
if (check) console.log('plugin references ok');
