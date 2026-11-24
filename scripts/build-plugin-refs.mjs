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
 * become block quotes; <Steps> / <Step title> become numbered "### Step" headings; <ResponseField> becomes a
 * list item with its type and default (nested in <Expandable>); <Card> becomes a list item linking to its
 * page; <Tab title> and <Accordion title> become a bold "Title:" line over their content; a <Frame> image becomes a list item with
 * its caption and alt text; a link to another page
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
  'quiesco-api': [
    'api',
    'api-matchers',
    'api-actions',
    'api-value-controls',
    'api-gestures',
    'api-assertions',
    'api-queries',
    'api-runtime-sync',
    'api-device',
    'api-system',
    'api-screenshots',
    'api-webview',
    'api-in-app',
    'api-tags',
    'api-constants',
    'api-types',
    'api-errors',
    'api-artifacts',
    'api-custom-runners',
    'config', 'sync', 'platforms', 'parallel', 'runners', 'vitest', 'jest', 'cucumber'],
  'writing-tests': ['tutorial', 'tutorial-vitest', 'tutorial-jest', 'tutorial-cucumber', 'steps', 'driver-pattern', 'driver-pattern-vitest', 'driver-pattern-jest', 'driver-pattern-cucumber'],
  setup: ['quickstart', 'cli'],
  debug: ['troubleshooting'],
};

const PACKAGE_MANAGERS = ['npm', 'pnpm', 'bun', 'yarn'];

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
  /** Inside a <CodeGroup>: of package-manager tabs only npm's is kept; other tabs are kept under their names. */
  let group = false;
  let skip = false;
  let step = 0;
  let stepIndent = 0;
  /** Indent of the open <Tab>'s content (after the step's indent is removed). */
  let tabIndent = 0;
  /** The open <Frame>'s caption. */
  /** @type {string | null} */
  let frame = null;
  /** An open <Card>: its link and the text collected so far. */
  /** @type {{ title: string, href: string, text: string[] } | null} */
  let card = null;
  /** Indent of the open <ResponseField>s' bodies, innermost last. */
  /** @type {number[]} */
  const fields = [];
  for (const raw of text.split('\n')) {
    let line = raw;
    if (stepIndent && line.startsWith(' '.repeat(stepIndent))) line = line.slice(stepIndent);
    else if (stepIndent) line = line.replace(/^\s+/, '');
    if (tabIndent && line.startsWith(' '.repeat(tabIndent))) line = line.slice(tabIndent);
    else if (tabIndent) line = line.replace(/^\s+/, '');
    const trimmed = line.trim();

    if (trimmed === '<CodeGroup>' || trimmed === '</CodeGroup>') {
      group = trimmed === '<CodeGroup>';
      continue;
    }
    if (/^(```|~~~)/.test(trimmed)) {
      fence = !fence;
      if (group && fence) {
        const [lang = '', tab = ''] = trimmed.slice(3).trim().split(/\s+/);
        // Package-manager tabs: keep npm's. Other tabs (Vitest / Jest / Cucumber): keep each, under its name.
        skip = PACKAGE_MANAGERS.includes(tab) && tab !== 'npm';
        if (!skip && tab !== '' && !PACKAGE_MANAGERS.includes(tab)) out.push('', `**${tab}:**`, '');
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

    if (/^<\/?(Tabs|AccordionGroup)>$/.test(trimmed)) continue;
    const t = /^(\s*)<(?:Tab|Accordion) title="(.*)">$/.exec(line);
    if (t) {
      tabIndent = t[1].length + 2;
      out.push(`**${t[2]}:**`, '');
      continue;
    }
    if (trimmed === '</Tab>' || trimmed === '</Accordion>') {
      tabIndent = 0;
      out.push('');
      continue;
    }
    if (/^<\/?Columns\b.*>$/.test(trimmed)) continue;
    const fr = /^<Frame caption="(.*)">$/.exec(trimmed);
    if (fr) {
      frame = fr[1];
      continue;
    }
    if (frame !== null) {
      const img = /^<img .*alt="(.*?)".*\/>$/.exec(trimmed);
      if (img) out.push(`- ${frame}: ${img[1]}`);
      if (trimmed === '</Frame>') frame = null;
      continue;
    }

    if (/^<\/?(CardGroup|Expandable)\b.*>$/.test(trimmed)) continue;
    const c = /^<Card title="(.*?)".*?href="\.?\/([a-z0-9-]+)">$/.exec(trimmed);
    if (c) {
      card = { title: c[1], href: c[2], text: [] };
      continue;
    }
    if (card) {
      if (trimmed === '</Card>') {
        out.push(`- [${card.title}](${linkTarget(card.href, skill)}): ${card.text.join(' ')}`);
        card = null;
      } else if (trimmed) card.text.push(trimmed);
      continue;
    }
    const f = /^(\s*)<ResponseField name="(.*?)" type="(.*?)"(?: default="(.*?)")?( required)?\s*(\/?)>$/.exec(line);
    if (f) {
      const depth = fields.length;
      const facts = [`\`${f[3]}\``, ...(f[4] !== undefined ? [`default \`${f[4]}\``] : []), ...(f[5] ? ['required'] : [])];
      out.push(`${'  '.repeat(depth)}- **\`${f[2]}\`** (${facts.join(', ')})${f[6] ? '' : ':'}`);
      if (!f[6]) fields.push(f[1].length + 2);
      continue;
    }
    if (trimmed === '</ResponseField>') {
      fields.pop();
      continue;
    }
    if (fields.length) {
      const indent = fields[fields.length - 1] ?? 0;
      const body = line.startsWith(' '.repeat(indent)) ? line.slice(indent) : line.trimStart();
      line = body ? `${'  '.repeat(fields.length)}${body}` : '';
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
