/**
 * `quiesco devices [--prune]` (Phase 6.12): the simulators and AVDs Quiesco created for parallel workers
 * ("<name> (Quiesco N)", "<avd>_quiesco_N"). `--prune` shuts them down and deletes them; the next
 * parallel run creates them again. Devices of your own are never listed or touched.
 */
import path from 'node:path';

import { WORKER_AVD, WORKER_SIMULATOR } from '@quiesco/core';

import type { CliContext } from '../context.js';

interface WorkerDevice {
  platform: 'ios' | 'android';
  name: string;
  /** iOS: the udid. Android: the adb serial when running. */
  id: string | null;
  running: boolean;
}

function sdkTool(ctx: CliContext, rel: string, fallback: string): string {
  const home = ctx.env['ANDROID_HOME'] ?? ctx.env['ANDROID_SDK_ROOT'];
  return home !== undefined ? path.join(home, rel) : fallback;
}

function avdHome(ctx: CliContext): string {
  return ctx.env['ANDROID_AVD_HOME'] ?? path.join(ctx.env['HOME'] ?? '~', '.android', 'avd');
}

async function iosWorkers(ctx: CliContext): Promise<WorkerDevice[]> {
  if (ctx.platform !== 'darwin') return [];
  const r = await ctx.exec('xcrun', ['simctl', 'list', 'devices', '--json']);
  if (r.code !== 0) return [];
  let json: { devices?: Record<string, { udid: string; name: string; state: string }[]> };
  try {
    json = JSON.parse(r.stdout) as typeof json;
  } catch {
    return [];
  }
  return Object.entries(json.devices ?? {}).flatMap(([runtime, ds]) =>
    ds
      .filter((d) => WORKER_SIMULATOR.test(d.name))
      .map((d) => ({ platform: 'ios' as const, name: `${d.name} (${runtime.replace(/^.*SimRuntime\./, '')})`, id: d.udid, running: d.state === 'Booted' })),
  );
}

async function androidWorkers(ctx: CliContext): Promise<WorkerDevice[]> {
  const list = await ctx.exec(sdkTool(ctx, 'emulator/emulator', 'emulator'), ['-list-avds']);
  if (list.code !== 0) return [];
  const avds = list.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => WORKER_AVD.test(l));
  if (avds.length === 0) return [];
  // Which of them run, and as which serial.
  const adb = sdkTool(ctx, 'platform-tools/adb', 'adb');
  const running = new Map<string, string>();
  const devices = await ctx.exec(adb, ['devices']);
  for (const line of devices.stdout.split('\n').slice(1)) {
    const [serial, state] = line.trim().split(/\s+/);
    if (serial === undefined || state !== 'device' || !serial.startsWith('emulator-')) continue;
    const name = (await ctx.exec(adb, ['-s', serial, 'shell', 'getprop ro.boot.qemu.avd_name'])).stdout.trim();
    if (name !== '') running.set(name, serial);
  }
  return avds.map((name) => ({ platform: 'android' as const, name, id: running.get(name) ?? null, running: running.has(name) }));
}

async function prune(ctx: CliContext, d: WorkerDevice): Promise<boolean> {
  if (d.platform === 'ios') {
    if (d.running) await ctx.exec('xcrun', ['simctl', 'shutdown', d.id as string]);
    return (await ctx.exec('xcrun', ['simctl', 'delete', d.id as string])).code === 0;
  }
  if (d.running && d.id !== null) await ctx.exec(sdkTool(ctx, 'platform-tools/adb', 'adb'), ['-s', d.id, 'emu', 'kill']);
  const home = avdHome(ctx);
  return (await ctx.exec('rm', ['-rf', path.join(home, `${d.name}.avd`), path.join(home, `${d.name}.ini`)])).code === 0;
}

export async function devicesCommand(args: readonly string[], ctx: CliContext): Promise<number> {
  const unknown = args.find((a) => a !== '--prune');
  if (unknown !== undefined) {
    ctx.err(`quiesco devices: unknown option "${unknown}" (only --prune)`);
    return 2;
  }
  const all = [...(await iosWorkers(ctx)), ...(await androidWorkers(ctx))];
  if (all.length === 0) {
    ctx.out('No devices created by Quiesco for parallel workers.');
    return 0;
  }
  if (!args.includes('--prune')) {
    ctx.out('Devices Quiesco created for parallel workers (delete them with `quiesco devices --prune`):');
    for (const d of all) ctx.out(`  ${d.platform.padEnd(8)}${d.name}${d.running ? '  [running]' : ''}`);
    return 0;
  }
  let failed = 0;
  for (const d of all) {
    if (await prune(ctx, d)) ctx.out(`deleted ${d.platform} ${d.name}`);
    else {
      failed++;
      ctx.err(`could not delete ${d.platform} ${d.name}`);
    }
  }
  return failed === 0 ? 0 : 1;
}
