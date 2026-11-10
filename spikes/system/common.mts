// Phase 6.7 spike helpers: a session on the example app (installs the fresh build), opened on its system page.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { Session } from '@quiesco/core';
import type { Platform } from '@quiesco/protocol';

export const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);
export const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)); // spike only

const app = path.resolve(import.meta.dirname, '../../examples/todo-app');

export async function open(platform: Platform): Promise<Session> {
  const metroUrl = process.env['QUIESCO_METRO_URL'] ?? 'http://localhost:8083';
  const apps = platform === 'ios'
    ? { ios: { bundleId: 'dev.quiesco.todo', binaryPath: path.join(app, 'ios/build/Build/Products/Debug-iphonesimulator/QuiescoTodo.app'), devClient: { metroUrl } } }
    : { android: { package: 'dev.quiesco.todo', binaryPath: path.join(app, 'android/app/build/outputs/apk/debug/app-debug.apk'), devClient: { scheme: 'quiescotodo', metroUrl }, reversePorts: [3001] } };
  const s = await Session.create({ platform, config: { apps, devices: { ios: { device: 'iPhone 17', os: '26.5' }, android: {} }, logLevel: 'warn', connectTimeoutMs: 90_000 } as never });
  await s.driver.backdoor('openSystem');
  await s.driver.expectVisible('system');
  return s;
}

/** Text of a testID, read without waiting for idle (system UI may keep the app inactive). */
export async function text(s: Session, id: string): Promise<string> {
  const [el] = await s.driver.query({ id }, { sync: false });
  return el?.text ?? '(missing)';
}

/** Poll a testID until `ok` or 10 s. */
export async function waitText(s: Session, id: string, ok: (t: string) => boolean): Promise<string> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const t = await text(s, id);
    if (ok(t) || Date.now() > deadline) return t;
    await pause(250);
  }
}

export function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch (e) {
    return `ERR ${(e as Error).message.split('\n')[0]}`;
  }
}

export function shot(s: Session, name: string): Promise<void> {
  return s.provider.screenshot().then((b) => fs.writeFileSync(path.join(process.env['SHOTS'] ?? '/tmp', `${name}.png`), b));
}

/** The simulator the session uses (two may be booted). */
export function udidOf(s: Session): string {
  return (s.provider as unknown as { udid: string }).udid;
}
