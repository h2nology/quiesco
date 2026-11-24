#!/usr/bin/env node
// @ts-check
/**
 * The API reference's Types page (docs/api-types.mdx and its zh / ja translations), generated from the
 * packages' sources so that it never drifts from them. Every type a method signature names in the API
 * reference has a section here: its declaration as written in the source, doc comments included.
 *
 *   node scripts/build-api-types.mjs           write the pages
 *   node scripts/build-api-types.mjs --check   exit 1 if a page is missing or out of date
 *
 * Declarations are found by name (`export interface X` / `export type X`) in packages/*\/src (core first); internal
 * references in doc comments (`(Phase 6.12)`, `(issue #77)`, `requirements.md §…`) are dropped. The prose
 * around them (title, intro, group headings) is per language. The zh / ja pages translate the doc comments
 * with scripts/api-types.i18n.json (English text -> translation): a comment without a translation, or a
 * translation no comment uses any more, fails the script, so a changed comment gets its translation updated.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');

/** Groups of the page, in order: id -> the types in it. */
export const GROUPS = {
  matchers: ['MatcherInput', 'ElementQuery', 'TextQuery'],
  results: ['ElementSummary', 'Rect', 'TreeNode', 'TrackerState', 'TrackerName'],
  geometry: ['Point', 'TimedPoint'],
  'call-options': [
    'CallOptions',
    'ActionOptions',
    'TapOptions',
    'LongPressOptions',
    'LongPressAtOptions',
    'TypeOptions',
    'ScrollOptions',
    'ScrollToIndexOptions',
    'SwipeOptions',
    'DragOptions',
    'PinchOptions',
    'RotateOptions',
    'MultiTouchOptions',
    'VisibleOptions',
    'WaitForIdleOptions',
  ],
  device: ['RelaunchOptions', 'StatusBarOptions', 'NotificationSpec', 'OpenNotificationOptions', 'SystemQuery', 'SystemWaitOptions', 'ScreenshotTarget', 'ScreenshotOptions'],
  webview: ['WebElementQuery', 'PageElement'],
  json: ['JsonValue', 'JsonPrimitive'],
  'in-app': ['WithQuiescoOptions', 'Backdoor', 'StorageAdapter'],
  runners: ['QuiescoVitestOptions', 'RegisterOptions', 'LifecycleOptions', 'ScenarioTags', 'ScenarioResult', 'AfterResult', 'Attachment', 'SessionOptions', 'WorkerInfo', 'ScenarioInfo', 'ScenarioArtifacts', 'Evidence'],
};

const TEXT = {
  en: {
    title: 'Types',
    description: 'The types the API reference names in method signatures: matchers, results, options, and the runner and in-app types.',
    intro:
      "Every type a method's signature names, with its declaration as written in Quiesco's source. Import them with\n`import type { … } from '@quiesco/core'`; the in-app types come from `@quiesco/agent`, the runner options from\nthe runner's package. The string unions (`Direction`, `Permission` …) are [constants](./api-constants).",
    groups: {
      matchers: 'Matchers',
      results: 'Results',
      geometry: 'Points',
      'call-options': 'Call options',
      device: 'Device',
      webview: 'WebView',
      json: 'JSON',
      'in-app': 'In the app',
      runners: 'Runners',
    },
  },
  zh: {
    title: '类型',
    description: 'API 参考的方法签名中出现的类型：匹配器、返回值、选项，以及 runner 和 App 内使用的类型。',
    intro:
      '方法签名中出现的每个类型，及其在 Quiesco 源码中的声明。用 `import type { … } from \'@quiesco/core\'` 导入；\nApp 内使用的类型来自 `@quiesco/agent`，runner 的选项来自各 runner 的包。字符串联合类型（`Direction`、`Permission` …）见[常量](./api-constants)。',
    groups: {
      matchers: '匹配器',
      results: '返回值',
      geometry: '坐标点',
      'call-options': '调用选项',
      device: '设备',
      webview: 'WebView',
      json: 'JSON',
      'in-app': 'App 内',
      runners: 'Runner',
    },
  },
  ja: {
    title: '型',
    description: 'APIリファレンスのメソッドシグネチャに出てくる型：マッチャー、戻り値、オプション、ランナーとアプリ内で使う型。',
    intro:
      'メソッドのシグネチャに出てくるすべての型と、Quiescoのソースでの宣言です。`import type { … } from \'@quiesco/core\'` でインポートします。\nアプリ内で使う型は `@quiesco/agent`、ランナーのオプションは各ランナーのパッケージから。文字列のユニオン型（`Direction`、`Permission` …）は[定数](./api-constants)を見てください。',
    groups: {
      matchers: 'マッチャー',
      results: '戻り値',
      geometry: '座標',
      'call-options': '呼び出しのオプション',
      device: 'デバイス',
      webview: 'WebView',
      json: 'JSON',
      'in-app': 'アプリ内',
      runners: 'ランナー',
    },
  },
};

/** @param {string} dir @returns {string[]} */
function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|cjs)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

/** Searched in this order: a name declared in two packages (agent's internal WaitForIdleOptions) is core's. */
const PACKAGES = ['core', 'protocol', 'vitest', 'jest', 'cucumber', 'agent'];
const files = PACKAGES.flatMap((pkg) => {
    const src = path.join(root, 'packages', pkg, 'src');
    const metro = path.join(root, 'packages', pkg, 'metro.cjs');
    return [...(fs.existsSync(src) ? sources(src).sort() : []), ...(fs.existsSync(metro) ? [metro] : [])];
  });

/** Drop internal references from a doc comment line. @param {string} line */
function clean(line) {
  return line
    .replace(/ \((?:Phase [\d.]+[a-z]?|issues? #\d+(?:[,/] ?#?\d+)*)(?:; [^)]*)?\)/g, '')
    .replace(/ \(requirements\.md[^)]*\)/g, '')
    .replace(/ \(HU [^)]*\)/g, '');
}

/** The declaration of `name`, doc comment included. @param {string} name */
function declaration(name) {
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    if (file.endsWith('.cjs')) {
      const i = lines.findIndex((l) => new RegExp(`@typedef \\{(.*)\\} ${name}$`).test(l));
      if (i === -1) continue;
      const body = /** @type {RegExpMatchArray} */ (lines[i].match(/@typedef \{\{ (.*) \}\}/))[1];
      const doc = lines[i - 1].replace(/^ \* /, '').trim();
      return [`/** ${doc} */`, `type ${name} = {`, ...body.split('; ').map((f) => `  ${f.replace(/;$/, '')};`), '};'].join('\n');
    }
    const at = lines.findIndex((l) => new RegExp(`^export (interface|type) ${name}\\b`).test(l));
    if (at === -1) continue;
    let start = at;
    if (lines[at - 1]?.trim().endsWith('*/')) {
      start = at - 1;
      while (!lines[start].trim().startsWith('/**')) start--;
    }
    let end = at;
    let depth = 0;
    for (;; end++) {
      for (const ch of lines[end]) depth += '{([<'.includes(ch) ? 1 : ')]}>'.includes(ch) && ch !== '>' ? -1 : 0;
      depth -= (lines[end].match(/(?<!=)>/g) ?? []).length;
      if (depth <= 0 && /[;}]\s*$/.test(lines[end])) break;
    }
    const decl = lines
      .slice(start, end + 1)
      .filter((l) => !/^\s*\/\/ eslint-disable/.test(l))
      .map((l) => clean(l).replace(/^export /, ''));
    if (name === 'TrackerName') {
      const names = fs.readFileSync(file, 'utf8').match(/TRACKER_NAMES = (\[[^\]]*\])/);
      if (names) return `type TrackerName = ${JSON.parse(names[1].replace(/'/g, '"')).map((/** @type {string} */ n) => `'${n}'`).join(' | ')};`;
    }
    return decl.join('\n');
  }
  throw new Error(`build-api-types: no declaration of ${name} in packages/*/src`);
}

/** @type {Record<'zh' | 'ja', Record<string, string>>} */
const I18N = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'api-types.i18n.json'), 'utf8'));
/** @type {string[]} */
const problems = [];
/** @type {Record<'zh' | 'ja', Set<string>>} */
const used = { zh: new Set(), ja: new Set() };

/** A doc comment's text on one line. @param {string} body the part between `/**` and `*\/` */
function commentText(body) {
  return body
    .split('\n')
    .map((l) => l.trim().replace(/^\*/, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The declaration with its doc comments translated. @param {string} decl @param {'zh' | 'ja'} lang */
function translate(decl, lang) {
  return decl.replace(/^([ \t]*)\/\*\*([\s\S]*?)\*\//gm, (_, indent, body) => {
    const en = commentText(body);
    const text = I18N[lang][en];
    if (text === undefined) {
      problems.push(`no ${lang} translation in scripts/api-types.i18n.json for: ${en}`);
      return `${indent}/** ${en} */`;
    }
    used[lang].add(en);
    return `${indent}/** ${text} */`;
  });
}

/** @param {'en' | 'zh' | 'ja'} lang */
function page(lang) {
  const t = TEXT[lang];
  const out = ['---', `title: "${t.title}"`, `description: "${t.description}"`, '---', '', '{/* Generated by scripts/build-api-types.mjs from the packages\' sources: edit those, then run the script. */}', '', t.intro, ''];
  for (const [id, names] of Object.entries(GROUPS)) {
    out.push(`## ${t.groups[/** @type {keyof typeof t.groups} */ (id)]} {#${id}}`, '');
    for (const name of names) out.push(`### \`${name}\` {#${name.toLowerCase()}}`, '', '```ts', lang === 'en' ? declaration(name) : translate(declaration(name), lang), '```', '');
  }
  return out.join('\n');
}

const check = process.argv.includes('--check');
const pages = /** @type {const} */ (['en', 'zh', 'ja']).map((lang) => /** @type {const} */ ([lang, page(lang)]));
for (const lang of /** @type {const} */ (['zh', 'ja'])) {
  for (const en of Object.keys(I18N[lang])) if (!used[lang].has(en)) problems.push(`unused ${lang} translation in scripts/api-types.i18n.json: ${en}`);
}
if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
let stale = 0;
for (const [lang, content] of pages) {
  const file = path.join(docs, lang === 'en' ? '' : lang, 'api-types.mdx');
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
      console.error(`${path.relative(root, file)} is out of date`);
      stale++;
    }
  } else {
    fs.writeFileSync(file, content);
    console.log(`wrote ${path.relative(root, file)}`);
  }
}
if (stale > 0) {
  console.error('Run `node scripts/build-api-types.mjs` to regenerate the Types page.');
  process.exit(1);
}
