/**
 * What a crashed app left behind (issue #76): the crash in Android's logcat crash buffer, or an iOS
 * crash report (`.ips` in ~/Library/Logs/DiagnosticReports), cut down to the lines that say why.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** A crash of the app under test. */
export interface CrashReport {
  /** A few lines: the exception and the top of the crashing thread's stack. */
  summary: string;
  /** The full report on this machine (iOS), to copy into the evidence. */
  file?: string;
}

/** Stack frames in a summary. */
const FRAMES = 8;
/** Longer symbols (C++ templates) are cut. */
const SYMBOL_CHARS = 140;

const LOGCAT_LINE = /^\s*(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+)\s+[VDIWEF]\s+([^:]*?)\s*:\s?(.*)$/;

interface LogcatLine {
  t: number;
  pid: string;
  tag: string;
  message: string;
}

function parseLogcat(text: string): LogcatLine[] {
  const out: LogcatLine[] = [];
  for (const line of text.split('\n')) {
    const m = LOGCAT_LINE.exec(line);
    if (m !== null) out.push({ t: Number(m[1]), pid: m[2] as string, tag: m[4] as string, message: (m[5] as string).replace(/\r$/, '') });
  }
  return out;
}

/**
 * The app's last crash in `adb logcat -b crash -v threadtime -v epoch` output at or after `sinceMs`
 * (ms since the epoch): a Java / Kotlin `FATAL EXCEPTION` (the exception and its first frames, with
 * the `Caused by` lines), or a native `Fatal signal` with the abort message and the first backtrace
 * frames. Null when the app did not crash there.
 */
export function androidCrash(logcat: string, pkg: string, sinceMs: number): string | null {
  const lines = parseLogcat(logcat).filter((l) => l.t * 1000 >= sinceMs - 1000);
  // Java: "FATAL EXCEPTION: main", then "Process: <pkg>, PID: <pid>".
  let java: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as LogcatLine;
    if (l.tag !== 'AndroidRuntime' || !l.message.startsWith('FATAL EXCEPTION')) continue;
    const next = lines[i + 1];
    if (next === undefined || !next.message.startsWith(`Process: ${pkg},`)) continue;
    const block = lines.slice(i).filter((b) => b.pid === l.pid && b.tag === 'AndroidRuntime').map((b) => b.message);
    // The exception, its first frames, and each "Caused by" with its first frame.
    const kept: string[] = [];
    let frames = 0;
    for (const m of block) {
      const frame = /^\s*at /.test(m);
      if (!frame) frames = 0;
      else if (++frames > (kept.some((k) => k.startsWith('Caused by')) ? 2 : FRAMES)) continue;
      kept.push(m.replace(/^\t/, '  '));
    }
    java = kept;
  }
  if (java !== null) return java.join('\n');
  // Native: libc "Fatal signal 6 (SIGABRT), code -1 (SI_QUEUE) in tid 1 (main), pid 1 (<pkg>)", then the
  // tombstone (tag DEBUG): "Abort message: …", "#00 pc …".
  const signal = [...lines].reverse().find((l) => l.message.startsWith('Fatal signal') && l.message.includes(`(${pkg})`));
  if (signal === undefined) return null;
  const after = lines.slice(lines.indexOf(signal) + 1);
  const abort = after.find((l) => l.message.startsWith('Abort message:'));
  const frames = after.filter((l) => /^\s*#\d+ pc /.test(l.message)).slice(0, FRAMES);
  return [signal.message, ...(abort !== undefined ? [abort.message] : []), ...frames.map((f) => `  ${f.message.trim()}`)].join('\n');
}

interface IpsBody {
  exception?: { type?: string; signal?: string; subtype?: string };
  termination?: { indicator?: string };
  asi?: Record<string, unknown>;
  faultingThread?: number;
  threads?: { frames?: { imageIndex?: number; symbol?: string; imageOffset?: number }[] }[];
  usedImages?: { name?: string }[];
}

/** The header (first line) of an `.ips` report, or null when it is not one. */
export function ipsHeader(text: string): { bundleID?: string; app_name?: string } | null {
  const end = text.indexOf('\n');
  try {
    return JSON.parse(end < 0 ? text : text.slice(0, end)) as { bundleID?: string; app_name?: string };
  } catch {
    return null;
  }
}

/** An iOS crash report (`.ips`, JSON) as a few lines: exception, termination reason, crashing thread's top frames. */
export function summarizeIps(text: string): string | null {
  const end = text.indexOf('\n');
  if (end < 0) return null;
  let body: IpsBody;
  try {
    body = JSON.parse(text.slice(end + 1)) as IpsBody;
  } catch {
    return null;
  }
  const lines: string[] = [];
  const e = body.exception;
  if (e?.type !== undefined) lines.push(`${e.type}${e.signal !== undefined ? ` (${e.signal})` : ''}${e.subtype !== undefined ? `: ${e.subtype}` : ''}${body.termination?.indicator !== undefined ? `, ${body.termination.indicator}` : ''}`);
  for (const v of Object.values(body.asi ?? {})) {
    for (const s of Array.isArray(v) ? v : [v]) if (typeof s === 'string' && s.trim() !== '') lines.push(s.trim());
  }
  const n = body.faultingThread;
  const frames = n === undefined ? undefined : body.threads?.[n]?.frames;
  if (frames !== undefined && frames.length > 0) {
    lines.push(`Thread ${n} crashed:`);
    frames.slice(0, FRAMES).forEach((f, i) => {
      const image = (f.imageIndex !== undefined ? body.usedImages?.[f.imageIndex]?.name : undefined) ?? '???';
      const symbol = f.symbol ?? (f.imageOffset !== undefined ? `+${f.imageOffset}` : '');
      lines.push(`  ${i} ${image}  ${symbol.length > SYMBOL_CHARS ? `${symbol.slice(0, SYMBOL_CHARS)}…` : symbol}`);
    });
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/** The newest `.ips` report in `dir` for `bundleId` written at or after `sinceMs`. */
export async function newestIosCrash(dir: string, bundleId: string, sinceMs: number): Promise<CrashReport | null> {
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.ips'));
  } catch {
    return null;
  }
  const candidates: { file: string; mtime: number }[] = [];
  for (const n of names) {
    const file = path.join(dir, n);
    const stat = await fs.stat(file).catch(() => null);
    if (stat !== null && stat.mtimeMs >= sinceMs - 1000) candidates.push({ file, mtime: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const c of candidates) {
    const text = await fs.readFile(c.file, 'utf8').catch(() => '');
    if (ipsHeader(text)?.bundleID !== bundleId) continue;
    return { summary: summarizeIps(text) ?? 'The crash report could not be read.', file: c.file };
  }
  return null;
}
