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
    env: {},
    out: (l) => lines.push(l),
    err: (l) => errors.push(l),
    exec: async (command, args, options = {}) => {
      calls.push({ command, args: [...args], ...(options.env !== undefined ? { env: options.env } : {}) });
      return { code: 0, stdout: '', stderr: '', ...answer(command, args) };
    },
    run: async (command, args, options = {}) => {
      calls.push({ command, args: [...args], ...(options.env !== undefined ? { env: options.env } : {}) });
      return answer(command, args).code ?? 0;
    },
    readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null),
    writeFile: (p, c) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, c);
    },
    exists: (p) => fs.existsSync(p),
    platform: 'darwin',
    nodeVersion: '24.22.1',
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

/** A freshly created Expo Router app (create-expo-app, SDK 58 template shape). */
export function freshExpoApp(ctx: FakeContext): void {
  ctx.put('package.json', JSON.stringify({ name: 'my-app', main: 'expo-router/entry', dependencies: { expo: '~58.0.23', 'expo-router': '~58.0.30', 'react-native-web': '^0.21.4' } }, null, 2));
  ctx.put('app.json', JSON.stringify({ expo: { name: 'my-app', scheme: 'myapp', plugins: ['expo-router'] } }, null, 2));
  ctx.put('package-lock.json', '{}');
  ctx.put('src/app/_layout.tsx', 'export default function Layout() { return null; }\n');
}
