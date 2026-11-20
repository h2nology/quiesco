#!/usr/bin/env node
// @ts-check
/**
 * Remove every package's build output (`dist`, `tsconfig.tsbuildinfo`) so the next `pnpm build` compiles
 * everything from the sources. `pnpm release:check` runs it first (issue #75): `tsc -b` only rebuilds
 * when a source changed, so a hand-edited `dist` file (a debug line added while reproducing a bug) would
 * otherwise be published as it is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packages = path.join(root, 'packages');
for (const d of fs.readdirSync(packages)) {
  const dir = path.join(packages, d);
  if (!fs.existsSync(path.join(dir, 'tsconfig.json'))) continue;
  for (const out of ['dist', 'tsconfig.tsbuildinfo']) fs.rmSync(path.join(dir, out), { recursive: true, force: true });
}
console.log('clean: removed dist and tsbuildinfo of every package');
