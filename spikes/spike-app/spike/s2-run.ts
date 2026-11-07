/**
 * S2 spike runner: for each scenario, trigger it from outside React, then poll every frame and record
 *  - when detector A (root fields) / B (scheduler) / A&&B first report idle
 *  - whether the expected final text is already in the fiber tree at that moment
 *  - false idles: idle reported, then busy again before reaching the final state
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Platform } from 'react-native';

import { findHostByTestID } from './fiber-query';
import { rootFieldsBusy, schedulerBusy } from './react-idle';
import { s2Control } from './S2Lab';
import { schedulerState } from './scheduler-tracker';

const SCENARIOS: { name: string; testID: string; expected: string }[] = [
  { name: 'basic', testID: 's2-basic', expected: 'basic:done' },
  { name: 'chain', testID: 's2-chain', expected: 'chain:5' },
  { name: 'transition', testID: 's2-transition', expected: 'items:150' },
  { name: 'suspense', testID: 's2-suspense', expected: 'suspense:loaded' },
  { name: 'deferred', testID: 's2-deferred', expected: 'deferred:100' },
  { name: 'activity', testID: 's2-activity', expected: 'activity:on' },
];

const textOf = (id: string) => findHostByTestID(id)[0]?.text;

function frame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function runOne(s: (typeof SCENARIOS)[number]): Promise<string> {
  const t0 = Date.now();
  s2Control.trigger!(s.name);
  const syncA = rootFieldsBusy();
  const syncB = schedulerBusy();
  const firstIdle: Record<'A' | 'B' | 'AB', { t: number; correct: boolean } | null> = { A: null, B: null, AB: null };
  const falseIdle = { A: 0, B: 0, AB: 0 };
  let idleButNotFinal = 0;
  let stableIdleButNotFinal = 0; // idle in two consecutive polls (separate macrotasks) but state not final
  let stableFirst: { t: number; correct: boolean } | null = null;
  let prevAB = false;
  let reachedAt: number | null = null;
  let prev = { A: false, B: false, AB: false };
  let polls = 0;
  const trace: string[] = [];
  let lastSig = '';
  for (let i = 0; i < 3000; i++) {
    await tick();
    polls++;
    const t = Date.now() - t0;
    const a = rootFieldsBusy().length === 0;
    const b = schedulerBusy().length === 0;
    const now = { A: a, B: b, AB: a && b };
    const correct = textOf(s.testID) === s.expected;
    const sig = `A=${rootFieldsBusy().join(',') || '-'} B=${schedulerBusy().length} text=${textOf(s.testID)}`;
    if (sig !== lastSig) {
      trace.push(`${t}ms ${sig}`);
      lastSig = sig;
    }
    if (correct && reachedAt == null) reachedAt = t;
    if (s.name === 'suspense' && t >= 280 && t <= 400) trace.push(`  poll ${t}ms AB=${now.AB} text=${textOf(s.testID)}`);
    if (now.AB && !correct) idleButNotFinal++;
    if (now.AB && prevAB && !correct) stableIdleButNotFinal++;
    if (now.AB && prevAB && !stableFirst) stableFirst = { t, correct };
    prevAB = now.AB;
    for (const k of ['A', 'B', 'AB'] as const) {
      if (now[k] && !firstIdle[k]) firstIdle[k] = { t, correct };
      // idle -> busy flip before the final state was reached = the earlier idle was false
      if (prev[k] && !now[k] && reachedAt == null) falseIdle[k]++;
    }
    prev = now;
    if (reachedAt != null && now.AB && i > 50) break;
  }
  const endBusy = [...rootFieldsBusy(), ...schedulerBusy()];
  if (s.name === 'suspense') console.log(`[S2-trace] ${Platform.OS} suspense\n  ` + trace.join('\n  '));
  return (
    `[S2] ${s.name}: syncAfterTrigger A=${JSON.stringify(syncA)} B=${syncB.length} | ` +
    `firstIdle A=${JSON.stringify(firstIdle.A)} B=${JSON.stringify(firstIdle.B)} AB=${JSON.stringify(firstIdle.AB)} | ` +
    `finalStateAt=${reachedAt}ms falseIdle=${JSON.stringify(falseIdle)} idleButNotFinal=${idleButNotFinal} stableIdleButNotFinal=${stableIdleButNotFinal} stableFirst=${JSON.stringify(stableFirst)} polls=${polls} endBusy=${JSON.stringify(endBusy)}`
  );
}

async function timerOrderProbe(label: string, before: () => void): Promise<string> {
  const t0 = Date.now();
  const logStart = schedulerState.runLog.length;
  const fired: string[] = [];
  before();
  await new Promise<void>((done) => {
    setTimeout(() => fired.push(`t300@${Date.now() - t0}`), 300);
    setTimeout(() => fired.push(`t0@${Date.now() - t0}`), 0);
    setTimeout(() => fired.push(`t16@${Date.now() - t0}`), 16);
    requestAnimationFrame(() => fired.push(`raf@${Date.now() - t0}`));
    Promise.resolve().then(() => fired.push(`micro@${Date.now() - t0}`));
    setTimeout(done, 450);
  });
  const runs = schedulerState.runLog.slice(logStart).filter((r) => r.at >= t0);
  const busyMs = runs.reduce((a, r) => a + r.dur, 0);
  const runsStr = runs
    .slice(0, 12)
    .map((r) => `#${r.id}p${r.p}@${r.at - t0}+${r.dur}${r.cont ? 'c' : ''}`)
    .join(' ');
  return `[S2-timer] ${label}: ${fired.join(' ')} | schedulerRuns=${runs.length} busyMs=${busyMs} ${runsStr}`;
}

export async function runS2(): Promise<void> {
  // let the initial mount settle
  for (let i = 0; i < 30; i++) await frame();
  const lines = [`[S2] platform=${Platform.OS} schedulerPatched=${schedulerState.patched} scheduledTotal=${schedulerState.scheduledTotal}`];
  lines.push(`[S2] baseline A=${JSON.stringify(rootFieldsBusy())} B=${JSON.stringify(schedulerBusy())}`);
  lines.push(await timerOrderProbe('plain', () => {}));
  for (const s of SCENARIOS) lines.push(await runOne(s));
  lines.push(await timerOrderProbe('plain-after', () => {}));
  lines.push(await timerOrderProbe('with-suspense', () => s2Control.trigger!('suspense2')));
  lines.push(await timerOrderProbe('with-basic-setState', () => s2Control.trigger!('basic')));
  lines.push(`[S2] end scheduledTotal=${schedulerState.scheduledTotal}`);
  console.log(lines.join('\n'));
}
