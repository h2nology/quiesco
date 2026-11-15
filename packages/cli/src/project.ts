/**
 * Where an Expo project renders its root (issue #20): the entry file, the component it registers, and
 * the files `<QuiescoRoot>` may be in.
 */
import path from 'node:path';

import type { CliContext } from './context.js';

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/** Root layouts of Expo Router apps and the usual root component files. */
const ROOT_CANDIDATES = ['app/_layout', 'src/app/_layout', 'App', 'src/App'].flatMap((base) => SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`));

/** `file` as given or with a source extension (or as a directory with an index file); null when none exists. */
export function resolveSource(ctx: CliContext, file: string): string | null {
  const candidates = [file, ...SOURCE_EXTENSIONS.map((ext) => `${file}${ext}`), ...SOURCE_EXTENSIONS.map((ext) => path.join(file, `index${ext}`))];
  return candidates.find((f) => /\.[cm]?[jt]sx?$/.test(f) && ctx.exists(f)) ?? null;
}

/** The project's entry file from package.json "main"; null for package entries (expo-router/entry) or when missing. */
export function entryFile(ctx: CliContext, main: string | undefined): string | null {
  return main === undefined ? null : resolveSource(ctx, path.join(ctx.cwd, main));
}

/**
 * The component an entry registers with `registerRootComponent(App)`, when `App` is imported from a local
 * file: its name and that file. null for anything else (inline components, packages, several calls).
 */
export function registeredRoot(ctx: CliContext, entry: string, source: string): { name: string; file: string | null; importPath: string } | null {
  const calls = [...source.matchAll(/registerRootComponent\(\s*([A-Za-z_$][\w$]*)\s*\)/g)];
  if (calls.length !== 1) return null;
  const name = (calls[0] as RegExpMatchArray)[1] as string;
  const imported = new RegExp(`import\\s+(?:${name}\\b|\\{[^}]*\\b(?:default\\s+as\\s+)?${name}\\b[^}]*\\})[^;'"]*from\\s+['"](\\.{1,2}/[^'"]+)['"]`).exec(source);
  if (imported === null) return null;
  const importPath = imported[1] as string;
  return { name, file: resolveSource(ctx, path.resolve(path.dirname(entry), importPath)), importPath };
}

/** The files `<QuiescoRoot>` is looked for in: the usual root files, the entry and the component it registers. */
export function rootSourceFiles(ctx: CliContext, main: string | undefined): string[] {
  const files = ROOT_CANDIDATES.map((f) => path.join(ctx.cwd, f));
  const entry = entryFile(ctx, main);
  if (entry !== null) {
    files.push(entry);
    const root = registeredRoot(ctx, entry, ctx.readFile(entry) ?? '');
    if (root?.file != null) files.push(root.file);
  }
  return [...new Set(files)].filter((f) => ctx.exists(f));
}

/**
 * Issue #20: wrap the component an entry registers in `<QuiescoRoot>`, without JSX (the entry is often
 * index.ts). Returns the new source, or null when the entry does not have the plain
 * `registerRootComponent(App)` shape with a local `App`, or already mentions QuiescoRoot.
 */
export function wrapRegisteredRoot(ctx: CliContext, entry: string, source: string): string | null {
  if (source.includes('QuiescoRoot')) return null;
  const root = registeredRoot(ctx, entry, source);
  if (root === null) return null;
  const agentImport = /^import '@quiesco\/agent';/m;
  let out = agentImport.test(source)
    ? source.replace(agentImport, "import { QuiescoRoot } from '@quiesco/agent';")
    : `import { QuiescoRoot } from '@quiesco/agent'; // first: Quiesco hooks into React before the app loads\n${source}`;
  out = out.replace(/(import\s[^;]*?from\s+['"]expo['"];?\n|import\s+['"]expo['"];?\n)/, `$1import { createElement } from 'react';\n`);
  if (!out.includes("import { createElement } from 'react';")) out = out.replace(/(^import \{ QuiescoRoot \}[^\n]*\n)/m, `$1import { createElement } from 'react';\n`);
  const wrapper = [
    `// <QuiescoRoot> connects the app to Quiesco and remounts it for the soft reset before each scenario`,
    `// (it renders ${root.name} unchanged in builds without EXPO_PUBLIC_QUIESCO=1).`,
    `function QuiescoApp() {`,
    `  return createElement(QuiescoRoot, null, createElement(${root.name}));`,
    `}`,
    ``,
    `registerRootComponent(QuiescoApp)`,
  ].join('\n');
  return out.replace(/registerRootComponent\(\s*[A-Za-z_$][\w$]*\s*\)/, wrapper);
}
