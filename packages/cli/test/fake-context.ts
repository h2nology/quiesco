import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CliContext, ExecResult } from '../src/context';

export interface FakeContext extends CliContext {
  lines: string[];
  errors: string[];
  calls: { command: string; args: string[]; env?: NodeJS.ProcessEnv }[];
  file(rel: string): string | null;
  put(rel: string, content: string): void;
}

/** A real temporary project directory; commands run through `exec` / `run` are recorded and answered by `answer`. */
export function fakeContext(answer: (command: string, args: readonly string[]) => Partial<ExecResult> = () => ({}), overrides: Partial<CliContext> = {}): FakeContext {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-cli-'));
  const lines: string[] = [];
  const errors: string[] = [];
  const calls: FakeContext['calls'] = [];
  const ctx: FakeContext = {
    cwd,
    version: '9.9.9',
    env: {},
    out: (l) => lines.push(l),
    err: (l) => errors.push(l),
    exec: async (command, args, options = {}) => {
      calls.push({ command, args: [...args], ...(options.env !== undefined ? { env: options.env } : {}) });
      const result = { code: 0, stdout: '', stderr: '', ...answer(command, args) };
      if (result.code === 0) fakeInstall(cwd, command, args);
      return result;
    },
    run: async (command, args, options = {}) => {
      calls.push({ command, args: [...args], ...(options.env !== undefined ? { env: options.env } : {}) });
      return answer(command, args).code ?? 0;
    },
    runPiped: async (command, args, options) => {
      calls.push({ command, args: [...args], ...(options.env !== undefined ? { env: options.env } : {}) });
      const a = answer(command, args);
      if (a.stdout !== undefined) options.onStdout(a.stdout);
      if (a.stderr !== undefined) options.onStderr(a.stderr);
      return a.code ?? 0;
    },
    terminal: null,
    resolveFrom: () => null,
    readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null),
    writeFile: (p, c) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, c);
    },
    exists: (p) => fs.existsSync(p),
    platform: 'darwin',
    nodeVersion: '24.22.1',
    interactive: false,
    // No dev server answers and none can be started unless a test overrides these.
    spawnBackground: () => {
      throw new Error('spawnBackground not expected in this test');
    },
    httpGet: async () => null,
    onInterrupt: () => () => {},
    sleep: async () => {},
    lines,
    errors,
    calls,
    file: (rel) => (fs.existsSync(path.join(cwd, rel)) ? fs.readFileSync(path.join(cwd, rel), 'utf8') : null),
    put: (rel, content) => {
      fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
      fs.writeFileSync(path.join(cwd, rel), content);
    },
    ...overrides,
  };
  return ctx;
}

/** The version a package spec installs: `name@1.2.3`, `file:…/name-1.2.3.tgz`; a bare name gets LATEST. */
export const LATEST = '0.0.1-latest';

/** `npm install` / `pnpm add` / … in the fake: write node_modules/<name>/package.json for each spec. */
function fakeInstall(cwd: string, command: string, args: readonly string[]): void {
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(command) || !['add', 'install'].includes(args[0] ?? '')) return;
  for (const spec of args.slice(1).filter((a) => !a.startsWith('-'))) {
    const file = /^file:.*[/\\]((?:@?[\w.-]+?))-(\d[^/\\]*)\.tgz$/.exec(spec);
    const at = /^(@?[^@]+)@(.+)$/.exec(spec);
    const [name, version] = file !== null ? [tarballName(file[1] as string), file[2] as string] : at !== null ? [at[1] as string, at[2] as string] : [spec, LATEST];
    const dir = path.join(cwd, 'node_modules', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
  }
}

/** quiesco-expo-plugin ⇒ @quiesco/expo-plugin (the reverse of the `pnpm pack` file name). */
const tarballName = (base: string): string => (base === 'quiesco' ? 'quiesco' : base.startsWith('quiesco-') ? `@quiesco/${base.slice('quiesco-'.length)}` : base);

/** A freshly created Expo Router app (create-expo-app, SDK 58 template shape). */
export function freshExpoApp(ctx: FakeContext): void {
  ctx.put('package.json', JSON.stringify({ name: 'my-app', main: 'expo-router/entry', dependencies: { expo: '~58.0.23', 'expo-router': '~58.0.30', 'react-native-web': '^0.21.4' } }, null, 2));
  ctx.put('app.json', JSON.stringify({ expo: { name: 'my-app', scheme: 'myapp', plugins: ['expo-router'] } }, null, 2));
  ctx.put('package-lock.json', '{}');
  ctx.put('src/app/_layout.tsx', 'export default function Layout() { return null; }\n');
}
