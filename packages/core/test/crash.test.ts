import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { androidCrash, newestIosCrash, summarizeIps } from '../src/devices/crash';

// `adb logcat -d -b crash -v threadtime -v epoch` as an API 36 emulator prints it (issue #76).
const T = 1795151284.564;
const javaCrash = (t: number, pid: number, pkg = 'dev.quiesco.todo') =>
  [
    `         ${t}  ${pid}  ${pid} E AndroidRuntime: FATAL EXCEPTION: main`,
    `         ${t}  ${pid}  ${pid} E AndroidRuntime: Process: ${pkg}, PID: ${pid}`,
    `         ${t}  ${pid}  ${pid} E AndroidRuntime: com.facebook.jni.CppException: [Worklets] Tried to synchronously call a Remote Function.`,
    ...Array.from({ length: 12 }, (_, i) => `         ${t}  ${pid}  ${pid} E AndroidRuntime: \tat frame${i}(Native Method)`),
    `         ${t}  ${pid}  ${pid} E AndroidRuntime: Caused by: java.lang.IllegalStateException: inner`,
    ...Array.from({ length: 5 }, (_, i) => `         ${t}  ${pid}  ${pid} E AndroidRuntime: \tat inner${i}(Inner.java:1)`),
  ].join('\n');

describe('androidCrash (#76)', () => {
  it('takes the app\'s FATAL EXCEPTION: the exception, its first 8 frames and each Caused by with 2', () => {
    const log = ['--------- beginning of crash', javaCrash(T - 600, 100), javaCrash(T, 2792), javaCrash(T, 300, 'other.app')].join('\n');
    const summary = androidCrash(log, 'dev.quiesco.todo', (T - 1) * 1000);
    expect(summary?.split('\n')).toEqual([
      'FATAL EXCEPTION: main',
      'Process: dev.quiesco.todo, PID: 2792',
      'com.facebook.jni.CppException: [Worklets] Tried to synchronously call a Remote Function.',
      ...Array.from({ length: 8 }, (_, i) => `  at frame${i}(Native Method)`),
      'Caused by: java.lang.IllegalStateException: inner',
      '  at inner0(Inner.java:1)',
      '  at inner1(Inner.java:1)',
    ]);
  });

  it('ignores crashes from before the launch and other apps\' crashes', () => {
    const log = [javaCrash(T - 600, 100), javaCrash(T, 300, 'other.app')].join('\n');
    expect(androidCrash(log, 'dev.quiesco.todo', (T - 1) * 1000)).toBeNull();
    expect(androidCrash('', 'dev.quiesco.todo', 0)).toBeNull();
  });

  it('a native crash: the fatal signal, the abort message and the first backtrace frames', () => {
    const log = [
      `         ${T}  2792  2810 F libc    : Fatal signal 6 (SIGABRT), code -1 (SI_QUEUE) in tid 2810 (mqt_v_js), pid 2792 (dev.quiesco.todo)`,
      `         ${T}  2900  2900 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***`,
      `         ${T}  2900  2900 F DEBUG   : Abort message: 'terminating due to uncaught exception of type facebook::jsi::JSError'`,
      ...Array.from({ length: 10 }, (_, i) => `         ${T}  2900  2900 F DEBUG   :       #0${i} pc 000000000005f0bc  /apex/lib${i}.so (abort+${i})`),
    ].join('\n');
    const lines = androidCrash(log, 'dev.quiesco.todo', (T - 1) * 1000)?.split('\n');
    expect(lines?.[0]).toMatch(/^Fatal signal 6 \(SIGABRT\)/);
    expect(lines?.[1]).toBe("Abort message: 'terminating due to uncaught exception of type facebook::jsi::JSError'");
    expect(lines?.slice(2)).toHaveLength(8);
    expect(lines?.[2]).toBe('  #00 pc 000000000005f0bc  /apex/lib0.so (abort+0)');
  });
});

/** An .ips report as the iOS 27 simulator writes it (header line, then the JSON body). */
function ips(bundleID: string, extra: Record<string, unknown> = {}): string {
  const header = { app_name: 'QuiescoTodo', bundleID, name: 'QuiescoTodo', bug_type: '309' };
  const body = {
    exception: { type: 'EXC_CRASH', signal: 'SIGABRT' },
    termination: { indicator: 'Abort trap: 6' },
    faultingThread: 3,
    usedImages: [{ name: 'libsystem_kernel.dylib' }, { name: 'hermesvm' }, { name: 'RNWorklets' }],
    threads: [
      {},
      {},
      {},
      {
        frames: [
          { imageIndex: 0, symbol: '__pthread_kill' },
          { imageIndex: 1, symbol: 'facebook::hermes::HermesRuntimeImpl::throwPendingError()' },
          { imageIndex: 2, symbol: `worklets::runSyncOnRuntime${'<T>'.repeat(60)}` },
          ...Array.from({ length: 10 }, () => ({ imageIndex: 2, imageOffset: 42 })),
        ],
      },
    ],
    ...extra,
  };
  return `${JSON.stringify(header)}\n${JSON.stringify(body, null, 2)}`;
}

describe('iOS crash reports (#76)', () => {
  it('summarizes an .ips: exception, termination, application info and the crashing thread\'s top frames', () => {
    const lines = summarizeIps(ips('dev.quiesco.todo', { asi: { libsystem_c: ['abort() called'] } }))?.split('\n');
    expect(lines?.slice(0, 4)).toEqual([
      'EXC_CRASH (SIGABRT), Abort trap: 6',
      'abort() called',
      'Thread 3 crashed:',
      '  0 libsystem_kernel.dylib  __pthread_kill',
    ]);
    expect(lines?.[5]).toMatch(/^ {2}2 RNWorklets {2}worklets::runSyncOnRuntime(<T>)+…$/);
    expect(lines?.[5]?.length).toBeLessThan(170);
    expect(lines?.slice(3)).toHaveLength(8);
    expect(summarizeIps('not json')).toBeNull();
  });

  it('finds the newest report of this app written since the launch', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-crash-'));
    const write = (name: string, text: string, mtime: number) => {
      fs.writeFileSync(path.join(dir, name), text);
      fs.utimesSync(path.join(dir, name), mtime / 1000, mtime / 1000);
    };
    const launch = Date.now() - 10_000;
    write('QuiescoTodo-old.ips', ips('dev.quiesco.todo'), launch - 60_000);
    write('Other-new.ips', ips('other.app'), launch + 5_000);
    write('QuiescoTodo-new.ips', ips('dev.quiesco.todo'), launch + 2_000);
    write('notes.txt', 'x', launch + 3_000);
    const report = await newestIosCrash(dir, 'dev.quiesco.todo', launch);
    expect(report?.file).toBe(path.join(dir, 'QuiescoTodo-new.ips'));
    expect(report?.summary).toMatch(/^EXC_CRASH \(SIGABRT\)/);
    expect(await newestIosCrash(dir, 'dev.quiesco.todo', launch + 4_000)).toBeNull();
    expect(await newestIosCrash(path.join(dir, 'missing'), 'dev.quiesco.todo', 0)).toBeNull();
  });
});
