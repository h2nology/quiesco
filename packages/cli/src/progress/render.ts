/**
 * The progress bar line of `quiesco test`, from a RunState. Pure (no terminal access) so it can be
 * unit-tested:
 *
 *   ▕██████████░░░░░░░░░░▏ 12/30  ✓10 ✗1 ↷1  2m13s  ▶ adds a todo
 *
 * - `~30`: the total is an estimate (Vitest) or still growing (Jest).
 * - Several workers: `▶ 1:adds a todo · 2:edits a todo` (worker numbers from 1).
 * - Fits in `width` columns (CJK characters count as two).
 */
import type { RunState } from '@quiesco/core';

export interface RenderOptions {
  width: number;
  color: boolean;
  /** Bar cells (default 20). */
  barWidth?: number;
}

// eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** East Asian wide and fullwidth characters, and emoji, take two columns. */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/** Terminal columns taken by `text` (ANSI escapes take none). */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of stripAnsi(text)) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0) || (code >= 0x300 && code <= 0x36f) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)) continue;
    w += isWide(code) ? 2 : 1;
  }
  return w;
}

/** Cut plain text (no ANSI) to `width` columns, ending with … when cut. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (textWidth(text) <= width) return text;
  let out = '';
  let w = 0;
  for (const ch of text) {
    const cw = textWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

const paint = (on: boolean, code: string, text: string) => (on ? `\u001b[${code}m${text}\u001b[0m` : text);

export function renderBar(state: RunState, options: RenderOptions): string {
  const { width, color } = options;
  const cells = options.barWidth ?? 20;
  if (state.phase === 'idle') return truncate('quiesco: waiting for the test runner…', width - 1);

  const total = state.total;
  const done = state.done;
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const filled = Math.round(ratio * cells);
  const failed = state.counts.failed > 0 || state.fileErrors.size > 0 || state.runErrors.length > 0;
  const bar = `▕${paint(color, failed ? '31' : '32', '█'.repeat(filled))}${paint(color, '2', '░'.repeat(cells - filled))}▏`;

  const totalText = `${state.totalIsApproximate ? '~' : ''}${total}`;
  const c = state.counts;
  const skipped = c.skipped + c.pending + c.todo + c.undefined + c.notRun;
  const parts = [
    `${bar} ${done}/${totalText}`,
    [paint(color, '32', `✓${c.passed}`), ...(c.failed > 0 ? [paint(color, '31', `✗${c.failed}`)] : []), ...(skipped > 0 ? [paint(color, '33', `↷${skipped}`)] : [])].join(' '),
    formatDuration(state.elapsedMs),
  ];
  let line = parts.join('  ');

  // What is running now, in the space left.
  const room = width - 1 - textWidth(line) - 4;
  if (state.phase === 'running' && state.running.size > 0 && room > 8) {
    const running = [...state.running.values()].sort((a, b) => (a.worker ?? 0) - (b.worker ?? 0));
    const many = running.length > 1;
    const text = running.map((r) => `${many && r.worker !== undefined ? `${r.worker + 1}:` : ''}${r.test.name}`).join(' · ');
    line += `  ${paint(color, '36', '▶')} ${truncate(text, room)}`;
  } else if (state.phase === 'ended') {
    line += `  ${state.interrupted ? paint(color, '33', 'interrupted') : state.success === true ? paint(color, '32', 'passed') : paint(color, '31', 'failed')}`;
  }
  return textWidth(line) <= width - 1 ? line : truncate(stripAnsi(line), width - 1);
}
