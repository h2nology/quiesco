import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import type { Exec } from '../src/devices/exec';
import { silentLogger } from '../src/logger';
import { IosProvider } from '../src/devices/ios';
import type { SystemRunnerLike } from '../src/devices/ios';
import { IosSystemRunner, PERMISSION_ALLOW, isConnectionRefused, PERMISSION_ALLOW_ONCE, PERMISSION_DENY, dismissButton, runnerCacheKey, screenNodes } from '../src/devices/ios-runner';
import type { RunnerScreen } from '../src/devices/ios-runner';

const f = (y: number) => [57, y, 140, 48];
// What the runner reported on the simulator (findings 6.7 batch C), in Japanese.
const NOTIFICATION_ALERT: RunnerScreen['alerts'][number] = {
  label: '“Quiesco Todo”は通知を送信します。よろしいですか?',
  id: '',
  frame: [41, 334, 320, 234],
  texts: [{ label: '“Quiesco Todo”は通知を送信します。よろしいですか?', frame: [71, 356, 260, 42] }],
  buttons: [
    { label: '許可しない', id: '', frame: [57, 504, 140, 48] },
    { label: '許可', id: '', frame: [205, 504, 140, 48] },
  ],
};
const FACE_ID_ALERT: RunnerScreen['alerts'][number] = {
  label: '顔を認識できません',
  id: 'com.apple.localauthentication.ax.authentication.alert',
  frame: [41, 347, 320, 208],
  texts: [],
  buttons: [
    { label: 'Face IDをやり直す', id: 'com.apple.localauthentication.ax.authentication.button.try-again', frame: f(435) },
    { label: '取消', id: 'com.apple.localauthentication.ax.authentication.button.cancel', frame: f(491) },
  ],
};

describe('iOS system UI runner screens (6.7 batch C)', () => {
  it('gives a permission alert\'s buttons ids by position, whatever the language', () => {
    const nodes = screenNodes({ alerts: [NOTIFICATION_ALERT], others: [] });
    expect(nodes.map((n) => [n.text, n.id])).toEqual([
      ['“Quiesco Todo”は通知を送信します。よろしいですか?', ''],
      ['許可しない', PERMISSION_DENY],
      ['許可', PERMISSION_ALLOW],
    ]);
    expect(nodes[2]!.bounds).toEqual({ x1: 205, y1: 504, x2: 345, y2: 552 });
    // Location: allow once, while using the app, don't allow.
    const loc = screenNodes({ alerts: [{ ...NOTIFICATION_ALERT, buttons: [0, 1, 2].map((i) => ({ label: `b${i}`, id: '', frame: f(400 + i * 50) })) }], others: [] });
    expect(loc.slice(1).map((n) => n.id)).toEqual([PERMISSION_ALLOW_ONCE, PERMISSION_ALLOW, PERMISSION_DENY]);
  });

  it('keeps real identifiers (Face ID) and lists banners after the alerts', () => {
    const nodes = screenNodes({ alerts: [FACE_ID_ALERT], others: [{ label: '今, Hello, body', id: 'ShortLook.Platter.Content.Seamless', frame: [8, 58, 386, 66] }] });
    expect(nodes.map((n) => n.id)).toEqual(['com.apple.localauthentication.ax.authentication.button.try-again', 'com.apple.localauthentication.ax.authentication.button.cancel', 'ShortLook.Platter.Content.Seamless']);
  });

  it('dismisses leftover alerts with cancel, else deny, else the first button', () => {
    expect(dismissButton(FACE_ID_ALERT)?.frame).toEqual(f(491));
    expect(dismissButton(NOTIFICATION_ALERT)?.frame).toEqual([57, 504, 140, 48]);
    expect(dismissButton({ ...FACE_ID_ALERT, id: 'x', buttons: [{ label: 'OK', id: 'ok', frame: f(1) }] })?.frame).toEqual(f(1));
  });

  it('caches the build per Xcode version and runner source', async () => {
    const read = async (p: string) => p;
    const a = await runnerCacheKey('Xcode 27.2\nBuild version 27B52', read);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await runnerCacheKey('Xcode 27.2\nBuild version 27B52\n', read)).toBe(a);
    expect(await runnerCacheKey('Xcode 27.3\nBuild version 27C10', read)).not.toBe(a);
  });
});

/** A runner whose screen changes as the test says; records taps. */
/** `missTaps`: taps that do not land (the notification stays on screen); others open it (it goes away). */
function fakeRunner(screens: RunnerScreen[], missTaps = 0) {
  const calls: string[] = [];
  const empty: RunnerScreen = { alerts: [], others: [] };
  const runner: SystemRunnerLike = {
    running: true,
    screen: async () => (screens.length > 1 ? screens.shift()! : (screens[0] ?? empty)),
    tap: async (x, y) => {
      calls.push(`tap ${x},${y}`);
      if (missTaps-- > 0) return;
      for (const sc of screens) sc.others = [];
    },
    openNotificationCenter: async () => {
      calls.push('center');
      screens.splice(0, screens.length, { alerts: [], others: [{ label: '2 分前, Reminder, body', id: 'cell', frame: [0, 300, 400, 80] }] });
    },
    stop: async () => void calls.push('stop'),
  };
  return { runner, calls };
}

describe('IosProvider system UI (6.7 batch C)', () => {
  const make = (r: SystemRunnerLike) => new IosProvider({ app: { bundleId: 'com.example.todo' }, systemRunner: r, exec: async () => ({ stdout: Buffer.from(''), stderr: '' }) });

  it('lists and taps SpringBoard UI through the runner', async () => {
    const { runner, calls } = fakeRunner([{ alerts: [NOTIFICATION_ALERT], others: [] }]);
    const p = make(runner);
    const nodes = await p.systemNodes();
    await p.tapSystemNode(nodes.find((n) => n.id === p.permissionDialog.allow[0])!);
    expect(calls).toEqual(['tap 275,528']);
  });

  it('opens a notification from its banner, else from Notification Center', async () => {
    const banner = fakeRunner([{ alerts: [], others: [{ label: '今, Reminder, body', id: 'ShortLook.Platter.Content.Seamless', frame: [8, 58, 386, 66] }] }]);
    await make(banner.runner).openNotification('Reminder');
    expect(banner.calls).toEqual(['tap 201,91']);

    const gone = fakeRunner([{ alerts: [], others: [] }]);
    await make(gone.runner).openNotification('Reminder');
    expect(gone.calls).toEqual(['center', 'tap 200,340']);
  });

  it('taps a notification only where two reads agree, and again while it is still there (batch D)', async () => {
    const at = (y: number) => ({ alerts: [], others: [{ label: '今, Reminder, body', id: 'ShortLook.Platter.Content.Seamless', frame: [8, y, 386, 66] }] });
    // Sliding in: 20 → 40 → 58, then still at 58; the first tap misses.
    const { runner, calls } = fakeRunner([at(20), at(40), at(58), at(58)], 1);
    await make(runner).openNotification('Reminder');
    expect(calls).toEqual(['tap 201,91', 'tap 201,91']);
  });

  it('dismisses alerts left over by the previous scenario before the next one, and stops the runner', async () => {
    const { runner, calls } = fakeRunner([{ alerts: [], others: [] }, { alerts: [FACE_ID_ALERT], others: [] }, { alerts: [], others: [] }]);
    const p = make(runner);
    await p.systemNodes(); // the runner is in use
    await p.resetDeviceState({} as never);
    expect(calls).toEqual(['tap 127,515']); // the cancel button
    await p.shutdown();
    expect(calls.at(-1)).toBe('stop');
  });

  it('dismissSystemAlerts starts the runner when needed and closes an alert covering the app (Phase 6.12)', async () => {
    const { runner, calls } = fakeRunner([{ alerts: [FACE_ID_ALERT], others: [] }, { alerts: [], others: [] }]);
    const p = make(runner);
    // No runner use yet in this session: the per-scenario check skips it, an action's retry does not.
    await p.resetDeviceState({} as never);
    expect(calls).toEqual([]);
    expect(await p.dismissSystemAlerts()).toEqual([FACE_ID_ALERT.label]);
    expect(calls).toEqual(['tap 127,515']);
    expect(await p.dismissSystemAlerts()).toEqual([]);
  });
});

describe('IosSystemRunner build (Phase 6.12)', () => {
  it('parallel workers building at once each build aside and end up with one cached runner', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-runner-'));
    try {
      let builds = 0;
      const exec: Exec = async (file, args) => {
        if (args[0] === '-version') return { stdout: Buffer.from('Xcode 27.2\nBuild version 27C1\n'), stderr: '' };
        builds++;
        const derived = args[args.indexOf('-derivedDataPath') + 1] as string;
        await new Promise((r) => setTimeout(r, 20));
        fs.mkdirSync(path.join(derived, 'Build/Products'), { recursive: true });
        fs.writeFileSync(path.join(derived, 'Build/Products/Runner_iphonesimulator.xctestrun'), file);
        return { stdout: Buffer.from(''), stderr: '' };
      };
      const runner = () => new IosSystemRunner({ udid: 'U', exec, logger: silentLogger, cacheDir }) as unknown as { build(): Promise<string> };
      const [a, b] = await Promise.all([runner().build(), runner().build()]);
      expect(builds).toBe(2);
      expect(a).toBe(b);
      expect(fs.existsSync(a)).toBe(true);
      // Only the final directory is left (no half-built or temporary copies).
      expect(fs.readdirSync(cacheDir)).toHaveLength(1);
      expect(fs.readdirSync(cacheDir)[0]).not.toMatch(/\.tmp-/);
      // The next session reuses it without building.
      await runner().build();
      expect(builds).toBe(2);
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

describe('IosSystemRunner restart (Phase 6.12)', () => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });

  /** A runner whose process and HTTP calls are stubbed: `answers` are the request results in order. */
  function stubbed(answers: (unknown | Error)[]) {
    const runner = new IosSystemRunner({ udid: 'U', exec: async () => ({ stdout: Buffer.from(''), stderr: '' }), logger: silentLogger });
    const counts = { start: 0, stop: 0, requests: 0 };
    const r = runner as unknown as { start(): Promise<void>; stop(): Promise<void>; request(m: string, p: string): Promise<unknown> };
    r.start = async () => void counts.start++;
    r.stop = async () => void counts.stop++;
    r.request = async () => {
      const a = answers[counts.requests++];
      if (a instanceof Error) throw a;
      return a;
    };
    return { runner, counts };
  }

  it('recognises a refused connection', () => {
    expect(isConnectionRefused(refused)).toBe(true);
    expect(isConnectionRefused(new Error('connect ECONNREFUSED 127.0.0.1:1'))).toBe(true);
    expect(isConnectionRefused(new Error('iOS system UI runner: /tap: 500'))).toBe(false);
    expect(isConnectionRefused(null)).toBe(false);
  });

  it('restarts a runner that stopped listening, once', async () => {
    const screen = { alerts: [], others: [] };
    const { runner, counts } = stubbed([refused, screen]);
    await expect(runner.screen()).resolves.toEqual(screen);
    expect(counts).toEqual({ start: 2, stop: 1, requests: 2 });
  });

  it('does not restart for other errors, nor more than once', async () => {
    const other = stubbed([new Error('iOS system UI runner: /tap: 500')]);
    await expect(other.runner.tap(1, 2)).rejects.toThrow(/500/);
    expect(other.counts.stop).toBe(0);
    const twice = stubbed([refused, refused]);
    await expect(twice.runner.tap(1, 2)).rejects.toBe(refused);
    expect(twice.counts).toEqual({ start: 2, stop: 1, requests: 2 });
  });
});
