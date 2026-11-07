/**
 * S3 spike runner (Android): tap the test buttons through the native module and verify
 *  - Pressable onPress fires (pressable-count increments)
 *  - Pressable pressed style is visible while the finger is down (host style backgroundColor)
 *  - RNGH RectButton onPress fires (rngh-count increments)
 * Uses S1 query for coordinates and S2 idle detection (double-checked) between steps.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Platform, StyleSheet } from 'react-native';

import SpikeTouch from '../modules/spike-touch/src/SpikeTouchModule';
import { findHostByTestID } from './fiber-query';
import { measureFiber } from './measure';
import { rootFieldsBusy, schedulerBusy } from './react-idle';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function waitReactIdle(): Promise<number> {
  const t0 = Date.now();
  let prev = false;
  for (let i = 0; i < 1000; i++) {
    await tick();
    const idle = rootFieldsBusy().length === 0 && schedulerBusy().length === 0;
    if (idle && prev) return Date.now() - t0;
    prev = idle;
  }
  throw new Error('react not idle');
}

function center(testID: string) {
  const m = findHostByTestID(testID)[0];
  const r = measureFiber(m.fiber).rect!;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

const text = (id: string) => findHostByTestID(id)[0]?.text;
const bg = (id: string) => StyleSheet.flatten(findHostByTestID(id)[0]?.fiber.memoizedProps.style)?.backgroundColor;

export async function runS3(): Promise<void> {
  if (Platform.OS === 'web') return;
  for (let i = 0; i < 30; i++) await tick();
  await waitReactIdle();
  const out: string[] = [`[S3] platform=${Platform.OS} (S4 on iOS)`];
  try {
    // 1. Pressable tap
    const before = text('pressable-count');
    const c = center('pressable-button');
    const t0 = Date.now();
    const r = await SpikeTouch.tap(c.x, c.y, 50);
    const idleMs = await waitReactIdle();
    out.push(`[S3] tap pressable at dp(${c.x.toFixed(1)},${c.y.toFixed(1)}) -> px(${r.x},${r.y}) down=${r.down} up=${r.up} hit=${(r as any).hit ?? '-'} | ${before} -> ${text('pressable-count')} | roundtrip=${Date.now() - t0}ms idleAfter=${idleMs}ms`);

    // 2. Pressed state while finger is down.
    // Pressability keeps `pressed` for minPressDuration (setTimeout) -> React-idle alone is not enough,
    // so here we poll for the expected colour and report how long it took (a timer tracker would cover this).
    const waitBg = async (want: string) => {
      const ts = Date.now();
      while (Date.now() - ts < 2000) {
        if (bg('pressable-button') === want) return Date.now() - ts;
        await tick();
      }
      return -1;
    };
    const IDLE = '#2563eb';
    const PRESSED = '#1e3a8a';
    const settleBefore = await waitBg(IDLE);
    await SpikeTouch.touchDown(c.x, c.y);
    await waitReactIdle();
    const bgDown = bg('pressable-button');
    const countWhileDown = text('pressable-count');
    const tUp = Date.now();
    await SpikeTouch.touchUp();
    await waitReactIdle();
    const bgRightAfterUp = bg('pressable-button');
    const releaseMs = await waitBg(IDLE);
    out.push(`[S3] pressed-state: settleBefore=${settleBefore}ms down=${bgDown}(${bgDown === PRESSED ? 'PRESSED' : 'NOT pressed'}) rightAfterUp+reactIdle=${bgRightAfterUp} releasedAfter=${releaseMs}ms (since up ${Date.now() - tUp}ms) | countWhileDown=${countWhileDown} after=${text('pressable-count')}`);

    // 3. RNGH RectButton
    const rb = text('rngh-count');
    const g = center('rngh-button');
    const rr = await SpikeTouch.tap(g.x, g.y, 50);
    await waitReactIdle();
    out.push(`[S3] tap rngh at px(${rr.x},${rr.y}) | ${rb} -> ${text('rngh-count')}`);

    // 4. 10 rapid taps on Pressable (no fixed sleeps, idle-synced)
    const b10 = text('pressable-count');
    const t10 = Date.now();
    for (let i = 0; i < 10; i++) {
      await SpikeTouch.tap(c.x, c.y, 30);
      await waitReactIdle();
    }
    out.push(`[S3] 10 taps: ${b10} -> ${text('pressable-count')} in ${Date.now() - t10}ms`);

    // 5. tap outside any button must not change counts
    const p0 = text('pressable-count');
    await SpikeTouch.tap(10, 120, 30);
    await waitReactIdle();
    out.push(`[S3] tap empty area: ${p0} -> ${text('pressable-count')}`);
  } catch (e) {
    out.push(`[S3] ERROR ${String(e)}`);
  }
  console.log(out.join('\n'));
}
