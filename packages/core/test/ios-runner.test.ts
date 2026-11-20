import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import type { Exec } from '../src/devices/exec';
import { silentLogger } from '../src/logger';
import { IosProvider, uikitNodes } from '../src/devices/ios';
import type { SystemRunnerLike } from '../src/devices/ios';
import { IosSystemRunner, backButton, PERMISSION_ALLOW, isConnectionRefused, isRunnerGone, PERMISSION_ALLOW_ONCE, PERMISSION_DENY, dismissButton, runnerCacheKey, screenNodes } from '../src/devices/ios-runner';
import type { RunnerElements, RunnerScreen } from '../src/devices/ios-runner';

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

  it('dismisses leftover alerts with cancel, else the first button; never answers a permission alert (#86)', () => {
    expect(dismissButton(FACE_ID_ALERT)?.frame).toEqual(f(491));
    expect(dismissButton(NOTIFICATION_ALERT)).toBeUndefined();
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
function fakeRunner(screens: RunnerScreen[], missTaps = 0, extra: Partial<SystemRunnerLike> = {}) {
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
    ...extra,
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
    await make(banner.runner).openNotification('Reminder', 10_000);
    expect(banner.calls).toEqual(['tap 201,91']);

    // No banner: Notification Center after BANNER_WAIT_MS, at most half the timeout (2 s here).
    const gone = fakeRunner([{ alerts: [], others: [] }]);
    await make(gone.runner).openNotification('Reminder', 4_000);
    expect(gone.calls).toEqual(['center', 'tap 200,340']);
  });

  it('opens a link from outside the app and answers SpringBoard\'s "Open in …?" with its right-hand button (#48)', async () => {
    const confirm = { label: 'Open in “Quiesco Todo”?', id: '', frame: [60, 380, 280, 140], texts: [], buttons: [{ label: 'Cancel', id: '', frame: [60, 476, 140, 44] }, { label: 'Open', id: '', frame: [200, 476, 140, 44] }] };
    const { runner, calls } = fakeRunner([{ alerts: [], others: [] }, { alerts: [confirm], others: [] }]);
    const exec: string[][] = [];
    const p = new IosProvider({ app: { bundleId: 'com.example.todo' }, systemRunner: runner, exec: async (_cmd: string, args: readonly string[]) => (exec.push([...args]), { stdout: Buffer.from(''), stderr: '' }) });
    (p as unknown as { sim: { udid: string } }).sim = { udid: 'SIM-1' }; // as after boot()
    await p.openUrlFromOutside('quiescotodo://lifecycle');
    expect(exec.at(-1)).toEqual(['simctl', 'openurl', 'SIM-1', 'quiescotodo://lifecycle']);
    expect(calls).toEqual(['tap 270,498']);
  });

  it('looks for a notification for the call\'s timeoutMs, in Notification Center too (#47)', async () => {
    const none = fakeRunner([{ alerts: [], others: [] }]);
    const t0 = Date.now();
    await expect(make(none.runner).openNotification('Other', 600)).rejects.toThrow(/no notification "Other" in a banner or Notification Center within 600ms/);
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(none.calls).toEqual(['center']);
  });

  it('taps a notification only where two reads agree, and again while it is still there (batch D)', async () => {
    const at = (y: number) => ({ alerts: [], others: [{ label: '今, Reminder, body', id: 'ShortLook.Platter.Content.Seamless', frame: [8, y, 386, 66] }] });
    // Sliding in: 20 → 40 → 58, then still at 58; the first tap misses.
    const { runner, calls } = fakeRunner([at(20), at(40), at(58), at(58)], 1);
    await make(runner).openNotification('Reminder', 10_000);
    expect(calls).toEqual(['tap 201,91', 'tap 201,91']);
  });

  it('does not count the runner start against the timeout (#64)', async () => {
    // The runner takes longer to start than the whole timeout; the notification is in Notification Center.
    const { runner, calls } = fakeRunner([{ alerts: [], others: [] }], 0, { start: () => new Promise((r) => setTimeout(r, 800)) });
    await make(runner).openNotification('Reminder', 600);
    expect(calls).toEqual(['center', 'tap 200,340']);
  });

  /** A runner that reports the app's state: in front once `opens` taps have been made. */
  function stateful(screens: RunnerScreen[], opensAfter: number, onTap: (n: number) => void = () => undefined) {
    let taps = 0;
    const r = fakeRunner(screens, Number.MAX_SAFE_INTEGER, { appState: async () => (taps >= opensAfter ? 4 : 2) });
    const tap = r.runner.tap;
    r.runner.tap = async (x, y) => {
      taps++;
      await tap(x, y);
      onTap(taps);
    };
    return r;
  }

  it('a tap counts once the app is in front, not when the banner goes away by itself (#68)', async () => {
    const banner = { alerts: [], others: [{ label: '今, Reminder, body', id: 'ShortLook.Platter.Content.Seamless', frame: [8, 58, 386, 66] }] };
    const screens: RunnerScreen[] = [banner];
    // The tap misses a banner sliding away: it is gone, the app stays suspended. Notification Center has it.
    const { runner, calls } = stateful(screens, 2, (n) => {
      if (n === 1) screens.splice(0, screens.length, { alerts: [], others: [] });
    });
    await make(runner).openNotification('Reminder', 10_000);
    expect(calls).toEqual(['tap 201,91', 'center', 'tap 200,340']);
  });

  it('in an expanded stack taps the topmost matching notification (#65)', async () => {
    const cell = (y: number, label: string) => ({ label, id: 'ListCell', frame: [0, y, 400, 80] });
    const collapsed = { alerts: [], others: [cell(300, '2 分前, Reminder, body')] };
    const expanded = { alerts: [], others: [cell(380, '5 分前, Reminder, older'), cell(200, 'Show less'), cell(280, '今, Reminder, body')] };
    const screens: RunnerScreen[] = [collapsed];
    // The first tap expands the stack (the app stays in the background); the second opens the newest one.
    const { runner, calls } = stateful(screens, 2, (n) => {
      if (n === 1) screens.splice(0, screens.length, expanded);
    });
    await make(runner).openNotification('Reminder', 10_000);
    expect(calls).toEqual(['tap 200,340', 'tap 200,320']);
  });

  it('on a locked device taps the "Open" button a tap shows next to the notification', async () => {
    const screens: RunnerScreen[] = [{ alerts: [], others: [{ label: '今, Reminder, body', id: 'ListCell', frame: [0, 300, 400, 80] }] }];
    const { runner, calls } = stateful(screens, 2, (n) => {
      if (n === 1) {
        screens.splice(0, screens.length, {
          alerts: [],
          others: [
            { label: '今, Reminder, body', id: 'ListCell', frame: [110, 300, 290, 80] },
            { label: '開く', id: '', frame: [14, 300, 90, 80] },
            { label: '1 時間前, Other app', id: 'ListCell', frame: [0, 390, 400, 80] },
          ],
        });
      }
    });
    await make(runner).openNotification('Reminder', 10_000);
    expect(calls).toEqual(['tap 200,340', 'tap 59,340']);
  });

  it('taps a revealed "Open" button as soon as it stands still, before iOS withdraws it (#82)', async () => {
    const cell = { label: '今, Reminder, body', id: 'ListCell', frame: [0, 300, 400, 80] };
    const screens: RunnerScreen[] = [{ alerts: [], others: [cell] }];
    let revealedAt = 0;
    let openTappedAfter = -1;
    const { runner, calls } = stateful(screens, 2, (n) => {
      if (n === 1) {
        revealedAt = Date.now();
        screens.splice(0, screens.length, { alerts: [], others: [{ ...cell, frame: [110, 300, 290, 80] }, { label: 'Open', id: 'swipe-action-button-identifier', frame: [14, 300, 90, 80] }] });
        // The hint is withdrawn after a while (~3 s on iOS 27; shorter here).
        setTimeout(() => screens.splice(0, screens.length, { alerts: [], others: [cell] }), 1_500);
      }
      if (n === 2) openTappedAfter = Date.now() - revealedAt;
    });
    await make(runner).openNotification('Reminder', 10_000);
    expect(calls).toEqual(['tap 200,340', 'tap 59,340']);
    expect(openTappedAfter).toBeGreaterThanOrEqual(0);
    expect(openTappedAfter).toBeLessThan(1_500);
  });

  it('re-reads SpringBoard for the settle check, never an app\'s slow element tree (#87)', async () => {
    const { runner } = fakeRunner([{ alerts: [FACE_ID_ALERT], others: [] }]);
    const p = make(runner);
    const reread = p.systemNodeReread({ text: 'Cancel', id: '', bounds: { x1: 0, y1: 0, x2: 1, y2: 1 } });
    expect((await reread!()).map((n) => n.id)).toContain('com.apple.localauthentication.ax.authentication.button.cancel');
    expect(p.systemNodeReread({ text: 'Email', id: '', bounds: { x1: 0, y1: 0, x2: 1, y2: 1 }, app: 'com.apple.SafariViewService' })).toBeNull();
  });

  it('starts the runner while the app goes to the background, once for a system UI call too (#82)', async () => {
    let starts = 0;
    const { runner } = fakeRunner([{ alerts: [], others: [] }], 0, { start: () => (starts++, new Promise((r) => setTimeout(r, 100))) });
    const p = make(runner);
    await p.sendToBackground({ suspend: async () => true } as never);
    await p.prepareSystemUi();
    expect(starts).toBe(1);
  });

  it('never taps another notification, or a button on the right, as the "Open" button', async () => {
    const screens: RunnerScreen[] = [{ alerts: [], others: [{ label: '今, Reminder, body', id: 'ListCell', frame: [0, 300, 400, 80] }] }];
    const { runner, calls } = stateful(screens, Number.MAX_SAFE_INTEGER, (n) => {
      if (n === 1) {
        // The tap expanded a group: another app's notification moved into the row, "Clear" showed up.
        screens.splice(0, screens.length, {
          alerts: [],
          others: [
            { label: 'Clear', id: '', frame: [300, 260, 90, 30] },
            { label: 'Yesterday, Hello from another app', id: 'ShortLook.Platter.Content.Seamless', frame: [0, 300, 400, 80] },
            { label: 'Clear', id: 'clear-button', frame: [320, 310, 70, 60] },
          ],
        });
      }
    });
    await expect(make(runner).openNotification('Reminder', 600)).rejects.toThrow(/tapped "Reminder" 1 time/);
    expect(calls).toEqual(['tap 200,340']);
  });

  it('says it tapped when the app never comes to the front (#68)', async () => {
    const banner = { alerts: [], others: [{ label: '今, Reminder, body', id: 'ShortLook.Platter.Content.Seamless', frame: [8, 58, 386, 66] }] };
    const { runner } = stateful([banner], Number.MAX_SAFE_INTEGER);
    await expect(make(runner).openNotification('Reminder', 600)).rejects.toThrow(/tapped "Reminder" 1 time\(s\), but the app did not come to the front within 600ms/);
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

  it('fails the next scenario on a permission alert the previous one left, without answering it (#86)', async () => {
    const { runner, calls } = fakeRunner([{ alerts: [], others: [] }, { alerts: [NOTIFICATION_ALERT], others: [] }]);
    const p = make(runner);
    await p.systemNodes(); // the runner is in use
    await expect(p.resetDeviceState({} as never)).rejects.toMatchObject({ errorName: 'RESET_FAILED', message: /permission alert left by the previous scenario is still up: ".*" \[.*\]/ });
    expect(await p.dismissSystemAlerts()).toEqual([]);
    expect(await p.unansweredSystemAlert()).toMatch(/^A system permission alert is up over the app: ".+" \[.+\]/);
    expect(calls).toEqual([]);
  });

  it('lists a system alert when no notification shows up (#85)', async () => {
    // The alert stays over Notification Center.
    const { runner } = fakeRunner([{ alerts: [NOTIFICATION_ALERT], others: [] }], 0, { openNotificationCenter: async () => {} });
    await expect(make(runner).openNotification('Reminder', 300)).rejects.toThrow(/seen: nothing; a system alert is up: ".+" \[.+, .+\]\)\. Answer the permission alert first/);
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
    await expect(twice.runner.tap(1, 2)).rejects.toMatchObject({ errorName: 'DEVICE_ERROR', message: expect.stringContaining('stopped answering twice (ECONNREFUSED)') });
    expect(twice.counts).toEqual({ start: 2, stop: 1, requests: 2 });
  });

  const reset = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });

  it('recognises a runner that went away while answering (#65)', () => {
    expect(isRunnerGone(reset)).toBe(true);
    expect(isRunnerGone(refused)).toBe(true);
    expect(isRunnerGone(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }))).toBe(true);
    expect(isRunnerGone(new Error('socket hang up'))).toBe(true);
    expect(isRunnerGone(new Error('iOS system UI runner: /tap: 500'))).toBe(false);
    expect(isRunnerGone(null)).toBe(false);
  });

  it('a reset connection restarts the runner: a read is sent again, a tap fails as DEVICE_ERROR (#65)', async () => {
    const screen = { alerts: [], others: [] };
    const read = stubbed([reset, screen]);
    await expect(read.runner.screen()).resolves.toEqual(screen);
    expect(read.counts).toEqual({ start: 2, stop: 1, requests: 2 });
    // The tap may have happened before the runner died: not repeated.
    const tap = stubbed([reset, { ok: true }]);
    await expect(tap.runner.tap(1, 2)).rejects.toMatchObject({ errorName: 'DEVICE_ERROR', message: expect.stringContaining('ended while answering (ECONNRESET); it was restarted') });
    expect(tap.counts).toEqual({ start: 2, stop: 1, requests: 1 });
  });
});

describe('goBack on iOS (issue #4)', () => {
  const make = (r: SystemRunnerLike) => new IosProvider({ app: { bundleId: 'com.example.todo' }, systemRunner: r, exec: async () => ({ stdout: Buffer.from(''), stderr: '' }) });
  const bar = (y: number, buttons: { label: string; id: string; frame: number[]; hittable: boolean }[]) => ({ frame: [0, y, 400, 44], buttons });

  it('picks UIKit\'s BackButton, else a hittable button in the left third, innermost bar first', () => {
    expect(backButton({ bars: [] })).toBeNull();
    expect(backButton({ bars: [bar(60, [{ label: 'Todos', id: 'BackButton', frame: [8, 64, 80, 36], hittable: true }])] })?.frame).toEqual([8, 64, 80, 36]);
    // a custom headerLeft without the UIKit id; a right-side button does not count
    expect(backButton({ bars: [bar(60, [{ label: 'Save', id: '', frame: [320, 64, 70, 36], hittable: true }, { label: 'Close', id: '', frame: [8, 64, 60, 36], hittable: true }])] })?.frame).toEqual([8, 64, 60, 36]);
    expect(backButton({ bars: [bar(60, [{ label: 'Save', id: '', frame: [320, 64, 70, 36], hittable: true }])] })).toBeNull();
    expect(backButton({ bars: [bar(60, [{ label: 'x', id: 'BackButton', frame: [8, 64, 80, 36], hittable: false }])] })).toBeNull();
    // nested stacks: the lower bar is the inner stack
    const outer = bar(60, [{ label: 'Home', id: 'BackButton', frame: [8, 64, 80, 36], hittable: true }]);
    const inner = bar(120, [{ label: 'List', id: 'BackButton', frame: [8, 124, 80, 36], hittable: true }]);
    expect(backButton({ bars: [outer, inner] })?.frame).toEqual([8, 124, 80, 36]);
  });

  it('taps the back button when there is one, else swipes from the left edge', async () => {
    const calls: string[] = [];
    let bars: ReturnType<typeof bar>[] = [bar(60, [{ label: 'Todos', id: 'BackButton', frame: [8, 64, 80, 36], hittable: true }])];
    const runner: SystemRunnerLike = {
      running: true,
      screen: async () => ({ alerts: [], others: [] }),
      tap: async (x, y) => void calls.push(`tap ${x},${y}`),
      openNotificationCenter: async () => {},
      stop: async () => {},
      navigationBar: async (id) => (calls.push(`bars ${id}`), { bars }),
      edgeSwipeBack: async () => void calls.push('swipe'),
    };
    const p = make(runner);
    await p.injectInput({ kind: 'goBack' });
    expect(calls).toEqual(['bars com.example.todo', 'tap 48,82']);
    bars = [];
    calls.length = 0;
    await p.injectInput({ kind: 'goBack' });
    expect(calls).toEqual(['bars com.example.todo', 'swipe']);
    // pressBack stays what it was: iOS has no system back button
    await expect(p.injectInput({ kind: 'back' })).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
  });
});

describe('IosProvider: UIKit UI of the app and of other apps (issues #49–#51)', () => {
  // XCUIElement.ElementType: 2 application, 4 window, 9 button, 48 staticText, 49 textField.
  const app = (elements: RunnerElements['elements'], state = 4): RunnerElements => ({ state, elements });
  const picker = app([
    { type: 2, label: 'Quiesco Todo', id: '', value: '', frame: [0, 0, 402, 874] },
    { type: 9, label: 'Next Month', id: '', value: '', frame: [340, 500, 30, 30] },
    { type: 48, label: '25', id: '', value: '', frame: [262, 721, 23, 24] },
    { type: 49, label: '', id: 'system-input', value: '输入', frame: [16, 400, 370, 34] },
    { type: 48, label: 'hidden', id: '', value: '', frame: [0, 0, 0, 0] },
  ]);

  it('maps UIKit elements to nodes: the label, else the value; no application, windows or empty frames', () => {
    expect(uikitNodes(picker.elements, 'dev.quiesco.todo')).toEqual([
      { text: 'Next Month', id: '', bounds: { x1: 340, y1: 500, x2: 370, y2: 530 }, app: 'dev.quiesco.todo' },
      { text: '25', id: '', bounds: { x1: 262, y1: 721, x2: 285, y2: 745 }, app: 'dev.quiesco.todo' },
      { text: '输入', id: 'system-input', bounds: { x1: 16, y1: 400, x2: 386, y2: 434 }, app: 'dev.quiesco.todo', field: true },
    ]);
  });

  function runnerWith(trees: Record<string, RunnerElements>) {
    const calls: string[] = [];
    const runner: SystemRunnerLike = {
      running: true,
      screen: async () => ({ alerts: [], others: [{ label: 'Banner', id: 'b', frame: [8, 58, 386, 66] }] }),
      tap: async (x, y) => void calls.push(`tap ${x},${y}`),
      openNotificationCenter: async () => {},
      stop: async () => {},
      elements: async (bundleId) => (calls.push(`elements ${bundleId}`), trees[bundleId] ?? app([], 1)),
      typeText: async (bundleId, text) => void calls.push(`type ${bundleId} ${text}`),
    };
    const p = new IosProvider({ app: { bundleId: 'dev.quiesco.todo' }, systemRunner: runner, exec: async () => ({ stdout: Buffer.from(''), stderr: '' }) });
    return { p, calls };
  }

  it('lists SpringBoard first, then the apps in front: a web auth session, Safari, the app (not apps in the background)', async () => {
    const { p, calls } = runnerWith({
      'com.apple.SafariViewService': app([{ type: 49, label: 'Email', id: '', value: '', frame: [20, 300, 360, 44] }]),
      'com.apple.mobilesafari': app([{ type: 49, label: 'Address', id: '', value: 'example.com', frame: [149, 806, 104, 20] }], 3),
      'dev.quiesco.todo': picker,
    });
    const nodes = await p.systemNodes();
    expect(nodes.map((n) => `${n.app ?? 'springboard'}:${n.text}`)).toEqual(['springboard:Banner', 'com.apple.SafariViewService:Email', 'dev.quiesco.todo:Next Month', 'dev.quiesco.todo:25', 'dev.quiesco.todo:输入']);
    expect(calls).toEqual(['elements com.apple.SafariViewService', 'elements com.apple.mobilesafari', 'elements dev.quiesco.todo']);
  });

  it('types with the keyboard of the app that has one: a web page in front shows up in the app\'s tree too', async () => {
    const { p, calls } = runnerWith({});
    const runner = (p as unknown as { options: { systemRunner: SystemRunnerLike } }).options.systemRunner;
    const typed = runner.typeText!;
    runner.typeText = async (bundleId, text) => {
      if (bundleId !== 'com.apple.SafariViewService') throw new Error(`iOS system UI runner: /typeText?bundleId=${bundleId}: no keyboard: the field did not take the focus`);
      await typed(bundleId, text);
    };
    await p.typeSystemNode({ text: 'Email', id: '', bounds: { x1: 20, y1: 300, x2: 380, y2: 344 }, app: 'dev.quiesco.todo', field: true }, 'ab');
    expect(calls).toEqual(['tap 200,322', 'type com.apple.SafariViewService a', 'type com.apple.SafariViewService b']);
  });

  it('types into a field of its app after tapping it; taps a screen point', async () => {
    const { p, calls } = runnerWith({});
    await p.typeSystemNode({ text: 'Email', id: '', bounds: { x1: 20, y1: 300, x2: 380, y2: 344 }, app: 'com.apple.SafariViewService' }, 'ann 你👍🏽');
    await p.tapSystemPoint(200, 90);
    // A character per request (a controlled input keeps up with them).
    expect(calls).toEqual(['tap 200,322', ...['a', 'n', 'n', ' ', '你', '👍🏽'].map((c) => `type com.apple.SafariViewService ${c}`), 'tap 200,90']);
  });
});
