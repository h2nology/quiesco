import { spawn } from 'node:child_process';
import path from 'node:path';

import { RunState } from '@quiesco/core';
import type { TestRef } from '@quiesco/core';
import { describe, expect, it } from 'vitest';

import { main } from '../src/cli';
import type { CliContext, Terminal } from '../src/context';
import { formatDuration, renderBar, stripAnsi, textWidth, truncate } from '../src/progress/render';
import { cucumberFormatArgs, progressWanted, runWithProgress } from '../src/progress/run';
import { StickyTerminal } from '../src/progress/sticky';
import { fakeContext } from './fake-context';
import { VirtualTerminal } from './helpers/virtual-terminal';

const t = (id: string, name = id): TestRef => ({ id, file: 'features/a.feature', name, path: [name] });

function running(): RunState {
  let now = 0;
  const s = new RunState(() => now);
  s.apply({ type: 'run:start', total: 30, totalIsEstimate: false, files: [] });
  for (let i = 0; i < 12; i++) {
    s.apply({ type: 'test:start', test: t(`t${i}`), attempt: 0, startedAt: 0 });
    s.apply({ type: 'test:end', test: t(`t${i}`), status: i === 3 ? 'failed' : i === 5 ? 'skipped' : 'passed', durationMs: 1, willRetry: false });
  }
  s.apply({ type: 'test:start', test: t('now', 'adds a todo'), attempt: 0, startedAt: 0 });
  now = 133_000;
  return s;
}

describe('renderBar', () => {
  it('shows the bar, done/total, the counts, the time and what runs now', () => {
    expect(renderBar(running(), { width: 100, color: false, barWidth: 10 })).toBe('▕████░░░░░░▏ 12/30  ✓10 ✗1 ↷1  2m13s  ▶ adds a todo');
  });

  it('counts the time from when the runner started (device and app included) when told', () => {
    const s = running(); // the first test started at 0; "now" is 133 s
    expect(renderBar(s, { width: 100, color: false, barWidth: 10, since: -20_000, now: () => 133_000 })).toContain('2m33s');
  });

  it('marks an estimated total with ~ and numbers the workers when several run', () => {
    const s = new RunState(() => 0);
    s.apply({ type: 'run:start', total: 6, totalIsEstimate: true, files: [] });
    s.apply({ type: 'test:start', test: t('a', 'first'), attempt: 0, startedAt: 0, worker: 1 });
    s.apply({ type: 'test:start', test: t('b', 'second'), attempt: 0, startedAt: 0, worker: 0 });
    expect(renderBar(s, { width: 100, color: false, barWidth: 4 })).toBe('▕░░░░▏ 0/~6  ✓0  0s  ▶ 1:second · 2:first');
  });

  it('fits the width, CJK names counting double; colors do not count', () => {
    const s = running();
    s.apply({ type: 'test:start', test: t('cjk', '新しいTODOを追加して一覧の先頭に表示されることを確認する'), attempt: 0, startedAt: 0 });
    const line = renderBar(s, { width: 60, color: true, barWidth: 10 });
    expect(textWidth(line)).toBeLessThanOrEqual(59);
    expect(line).toContain('\u001b[32m');
    expect(stripAnsi(line)).toMatch(/…$/);
  });

  it('says how the run ended, and waits before the first event', () => {
    const s = running();
    s.apply({ type: 'run:end', success: false, interrupted: false, durationMs: 1 });
    expect(renderBar(s, { width: 100, color: false, barWidth: 10 })).toMatch(/12\/30 {2}✓10 ✗1 ↷2 {2}2m13s {2}failed$/);
    expect(renderBar(new RunState(), { width: 100, color: false })).toBe('quiesco: waiting for the test runner…');
  });

  it('helpers: width, truncation, durations', () => {
    expect(textWidth('ab漢字')).toBe(6);
    expect(textWidth('\u001b[31mx\u001b[0m')).toBe(1);
    expect(truncate('漢字漢字', 5)).toBe('漢字…');
    expect(truncate('short', 10)).toBe('short');
    expect([formatDuration(5_400), formatDuration(65_000), formatDuration(3_725_000)]).toEqual(['5s', '1m05s', '1h02m']);
  });
});

describe('StickyTerminal (on a virtual terminal)', () => {
  function setup(columns = 40) {
    const vt = new VirtualTerminal(columns);
    const sticky = new StickyTerminal({ write: (s) => vt.write(s), columns: () => columns });
    return { vt, sticky, child: (s: string) => sticky.output(s, (x) => vt.write(x)) };
  }

  it('keeps the bar on the last line while output scrolls above it', () => {
    const { vt, sticky, child } = setup();
    sticky.setBar('BAR 1/3');
    child('line one\nline two\n');
    sticky.setBar('BAR 2/3');
    child('line three\n');
    expect(vt.screen()).toEqual(['line one', 'line two', 'line three', 'BAR 2/3']);
  });

  it('an unfinished line (progress dots) stays above the bar and is completed in place', () => {
    const { vt, sticky, child } = setup();
    sticky.setBar('BAR');
    child('..');
    child('.F');
    expect(vt.screen()).toEqual(['...F', 'BAR']);
    child('.\n\n2 scenarios\n');
    expect(vt.screen()).toEqual(['...F.', '', '2 scenarios', 'BAR']);
  });

  it('erases a wrapped unfinished line completely', () => {
    const { vt, sticky, child } = setup(10);
    sticky.setBar('BAR');
    child('x'.repeat(25));
    child('\nnext\n');
    expect(vt.screen()).toEqual(['xxxxxxxxxx', 'xxxxxxxxxx', 'xxxxx', 'next', 'BAR']);
  });

  it('stop() removes the bar, keeps an unfinished line and writes the final line', () => {
    const { vt, sticky, child } = setup();
    sticky.setBar('BAR');
    child('out\npartial');
    sticky.stop('FINAL');
    expect(vt.screen()).toEqual(['out', 'partial', 'FINAL']);
    child('late\n'); // after stop the child's output passes straight through
    expect(vt.screen()).toEqual(['out', 'partial', 'FINAL', 'late']);
  });
});

function fakeTerminal(columns = 80) {
  const vt = new VirtualTerminal(columns);
  const interrupts: (() => void)[] = [];
  const terminal: Terminal = { columns: () => columns, color: false, stdout: (s) => vt.write(s), stderr: (s) => vt.write(s), onInterrupt: (h) => (interrupts.push(h), () => {}) };
  return { vt, terminal };
}

describe('quiesco test with the progress bar', () => {
  it('shows it on a terminal, not in CI, not with --no-progress or QUIESCO_PROGRESS=0', () => {
    const ctx = fakeContext(undefined, { terminal: fakeTerminal().terminal });
    expect(progressWanted(ctx, false)).toBe(true);
    expect(progressWanted(ctx, true)).toBe(false);
    expect(progressWanted({ ...ctx, env: { CI: 'true' } }, false)).toBe(false);
    expect(progressWanted({ ...ctx, env: { QUIESCO_PROGRESS: '0' } }, false)).toBe(false);
    expect(progressWanted(fakeContext(), false)).toBe(false); // not a terminal
  });

  it('adds the events formatter to cucumber-js with a file target, from the project’s @quiesco/cucumber', () => {
    const ctx = fakeContext(undefined, { resolveFrom: () => '/proj/node_modules/@quiesco/cucumber/dist/events-formatter.js' });
    expect(cucumberFormatArgs(ctx)).toEqual(['--format', '"file:///proj/node_modules/@quiesco/cucumber/dist/events-formatter.js":"/dev/null"']);
    expect(cucumberFormatArgs(fakeContext())).toEqual([]);
  });

  it('runs the runner piped with QUIESCO_EVENTS and the formatter, keeps its output, and hints when no events came', async () => {
    const { vt, terminal } = fakeTerminal();
    const ctx = fakeContext(() => ({ code: 1, stdout: 'runner output\n' }), { terminal, resolveFrom: () => '/p/events-formatter.js' });
    expect(await main(['test', '--platform', 'web', 'features/a.feature'], ctx)).toBe(1);
    const call = ctx.calls[0];
    expect(call?.args).toEqual(['cucumber-js', '--format', '"file:///p/events-formatter.js":"/dev/null"', 'features/a.feature']);
    expect(call?.env?.['QUIESCO_EVENTS']).toMatch(/quiesco-\d+-[0-9a-f]{8}\.sock$/);
    expect(call?.env?.['COLUMNS']).toBe('80');
    expect(vt.screen()).toEqual(['runner output']);
    expect(ctx.errors[0]).toMatch(/no test progress was received\. Install @quiesco\/cucumber/);
  });

  it('--no-progress keeps the terminal attached as before', async () => {
    const ctx = fakeContext(undefined, { terminal: fakeTerminal().terminal, runPiped: () => Promise.reject(new Error('not piped')) });
    expect(await main(['test', '--platform', 'web', '--no-progress', 'x'], ctx)).toBe(0);
    expect(ctx.calls[0]?.args).toEqual(['cucumber-js', 'x']);
  });
});

describe('runWithProgress with a real child process sending events', () => {
  it('draws the bar from the events and leaves the final state on the last line', async () => {
    const { vt, terminal } = fakeTerminal(100);
    const child = path.join(__dirname, 'helpers', 'progress-child.mjs');
    const base = fakeContext();
    const ctx: CliContext = {
      ...base,
      terminal,
      runPiped: (command, args, options) =>
        new Promise((resolve) => {
          const p = spawn(command, [...args], { env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
          p.stdout.setEncoding('utf8').on('data', options.onStdout);
          p.stderr.setEncoding('utf8').on('data', options.onStderr);
          p.on('close', (code) => resolve(code ?? 1));
        }),
    };
    const code = await runWithProgress(ctx as CliContext & { terminal: Terminal }, { command: process.execPath, args: [child], env: process.env, runner: 'jest' });
    expect(code).toBe(1);
    const screen = vt.screen();
    expect(screen.slice(0, 3)).toEqual(['test a', 'test b', 'test c']);
    expect(screen.at(-1)).toMatch(/^▕[█░]+▏ 3\/3 {2}✓2 ✗1 {2}\d+s {2}failed$/);
    expect(base.errors).toEqual([]);
  });
});
