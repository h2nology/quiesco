// 6.9 spike: per-scenario video and device logs on each platform (the example app must be running on the
// booted simulator / emulator). Measures how long recording takes to start / stop and whether the file is
// a complete MP4 / WebM; then how app-filtered device logs look.
// Usage: node spikes/artifacts/video-logs.mts ios|android|web
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)); // spike only
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-artifacts-'));
const platform = process.argv[2] ?? 'ios';
const ADB = `${process.env['HOME']}/Library/Android/sdk/platform-tools/adb`;
const adb = (...a: string[]): string => execFileSync(ADB, ['-s', 'emulator-5554', ...a], { encoding: 'utf8' }).trim();

/** MP4: an `ftyp` box first and a `moov` box somewhere (missing when the recorder was killed). */
function checkMp4(file: string): string {
  const b = fs.readFileSync(file);
  return `${b.length} bytes, ftyp ${b.subarray(4, 8).toString() === 'ftyp'}, moov ${b.includes(Buffer.from('moov'))}`;
}

async function ios(): Promise<void> {
  const udid = execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { encoding: 'utf8' });
  const booted = Object.values(JSON.parse(udid).devices as Record<string, { udid: string; name: string }[]>).flat();
  log('booted', booted.map((d) => `${d.name} ${d.udid}`).join(', '));
  const id = booted.find((d) => d.udid.startsWith('DD8F'))?.udid ?? booted[0]!.udid;
  for (const round of [1, 2]) {
    const file = path.join(out, `ios-${round}.mp4`);
    const t0 = Date.now();
    const rec = spawn('xcrun', ['simctl', 'io', id, 'recordVideo', '--codec=h264', '--force', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    rec.stderr.on('data', (d) => (err += String(d)));
    while (!/Recording started/i.test(err) && rec.exitCode === null && Date.now() - t0 < 10_000) await pause(20);
    log(`ios #${round} recording started after ${Date.now() - t0} ms`);
    // Something happens on screen meanwhile: open the app's URL.
    await pause(2000);
    const t1 = Date.now();
    rec.kill('SIGINT');
    await new Promise((r) => rec.once('exit', r));
    log(`ios #${round} stopped in ${Date.now() - t1} ms:`, checkMp4(file));
  }
  // App-filtered system log.
  const t0 = Date.now();
  const ls = spawn('xcrun', ['simctl', 'spawn', id, 'log', 'stream', '--style', 'compact', '--level', 'debug', '--predicate', 'process == "QuiescoTodo"'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let lines = '';
  ls.stdout.on('data', (d) => (lines += String(d)));
  execFileSync('xcrun', ['simctl', 'openurl', id, 'quiescotodo://todos']);
  await pause(3000);
  ls.kill('SIGINT');
  const all = lines.split('\n').filter((l) => l.trim() !== '');
  log(`ios log stream: ${all.length} lines in ${Date.now() - t0} ms; sample:\n  ${all.slice(1, 6).join('\n  ')}`);
}

async function android(): Promise<void> {
  for (const round of [1, 2]) {
    const remote = `/sdcard/quiesco-${round}.mp4`;
    const t0 = Date.now();
    const rec = spawn(ADB, ['-s', 'emulator-5554', 'shell', 'screenrecord', '--bit-rate', '4000000', remote], { stdio: 'ignore' });
    // screenrecord prints nothing when it starts: wait until its process is there.
    while (adb('shell', 'pidof', 'screenrecord').length === 0 && Date.now() - t0 < 5000) await pause(50);
    log(`android #${round} screenrecord running after ${Date.now() - t0} ms`);
    adb('shell', 'input', 'swipe', '500', '1500', '500', '600', '300');
    await pause(2000);
    const t1 = Date.now();
    adb('shell', 'pkill', '-INT', 'screenrecord');
    await new Promise((r) => rec.once('exit', r));
    // The file is finalized when the process exits.
    const file = path.join(out, `android-${round}.mp4`);
    adb('pull', remote, file);
    adb('shell', 'rm', remote);
    log(`android #${round} stopped + pulled in ${Date.now() - t1} ms:`, checkMp4(file));
  }
  const uid = /uid:(\d+)/.exec(adb('shell', 'pm', 'list', 'packages', '-U', 'dev.quiesco.todo'))?.[1];
  log('app uid', uid);
  const t0 = Date.now();
  const lc = spawn(ADB, ['-s', 'emulator-5554', 'logcat', '-v', 'threadtime', '-T', '1', `--uid=${uid}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let lines = '';
  lc.stdout.on('data', (d) => (lines += String(d)));
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'quiescotodo://todos');
  await pause(3000);
  lc.kill('SIGINT');
  const all = lines.split('\n').filter((l) => l.trim() !== '');
  log(`android logcat --uid: ${all.length} lines in ${Date.now() - t0} ms; sample:\n  ${all.slice(0, 6).join('\n  ')}`);
}

async function web(): Promise<void> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent('<div id=c style="font:40px sans-serif">0</div><script>let n=0;setInterval(()=>document.getElementById("c").textContent=++n,100)</script>');
  for (const round of [1, 2]) {
    const file = path.join(out, `web-${round}.webm`);
    const t0 = Date.now();
    await page.screencast.start({ path: file });
    log(`web #${round} screencast started in ${Date.now() - t0} ms`);
    await pause(2000);
    const t1 = Date.now();
    await page.screencast.stop();
    const b = fs.readFileSync(file);
    log(`web #${round} stopped in ${Date.now() - t1} ms: ${b.length} bytes, EBML ${b.subarray(0, 4).toString('hex') === '1a45dfa3'}`);
  }
  const msgs: string[] = [];
  page.on('console', (m) => msgs.push(`${m.type()}: ${m.text()}`));
  await page.evaluate(() => console.warn('from the page'));
  log('console', msgs);
  await browser.close();
}

await ({ ios, android, web } as Record<string, () => Promise<void>>)[platform]!();
log('files in', out);
