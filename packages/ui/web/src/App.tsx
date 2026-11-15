import type { RunState } from '@quiesco/core/run-state';
import { emptyCounts } from '@quiesco/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useUiConnection } from './connection';
import type { UiData } from './connection';
import { Detail } from './Detail';
import { Device, Logo, Moon, Play, Search, Spinner, Stop, Sun, Check, X, Skip } from './icons';
import { allTests, formatMs } from './model';
import type { Filter, Sort } from './model';
import { TestTree } from './TestTree';

type Theme = 'dark' | 'light';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('quiesco-ui-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Storage blocked: use the system's preference.
  }
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem('quiesco-ui-theme', theme);
    } catch {
      // Not remembered: fine.
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

/** Re-renders every second while a run is going (elapsed time). */
function useTicker(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

export function App() {
  const ui = useUiConnection();
  const [theme, toggleTheme] = useTheme();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('default');
  const [selected, setSelected] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const running = ui.running !== null;
  useTicker(running);

  // Select the first failed test when nothing is selected yet.
  const tests = useMemo(() => allTests(ui), [ui]);
  useEffect(() => {
    if (selected !== null && tests.some((t) => t.id === selected)) return;
    const failed = tests.find((t) => ui.state.tests.get(t.id)?.status === 'failed');
    if (failed !== undefined) setSelected(failed.id);
  }, [tests, selected, ui.state]);

  // Global shortcuts: / search, Ctrl/⌘+Enter run all, Ctrl/⌘+. stop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!running) ui.run({ kind: 'all' });
      } else if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        ui.send({ type: 'cancel' });
      } else if (e.key === 'Escape' && e.target === searchRef.current) {
        setQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, ui]);

  // One announcement per finished run (screen readers).
  const [announce, setAnnounce] = useState('');
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      const c = ui.state.counts;
      setAnnounce(`Run finished: ${c.passed} passed, ${c.failed} failed, ${c.skipped + c.pending + c.todo} skipped.`);
    }
    wasRunning.current = running;
  }, [running, ui.state]);

  const info = ui.info;
  return (
    <div className="app">
      <a className="skip-link" href="#detail">
        Skip to test details
      </a>
      <header className="header">
        <div className="row">
          <div className="logo" aria-hidden="true">
            <Logo size={16} />
          </div>
          <span className="display" style={{ fontWeight: 700, fontSize: 16 }}>
            Quiesco
          </span>
          {info !== null && <span className="pill">{`${info.project} · ${info.runner} · ${info.platform}`}</span>}
        </div>
        <div className="search">
          <Search size={16} className="muted" />
          <label htmlFor="search" className="sr-only">
            Search tests
          </label>
          <input id="search" ref={searchRef} type="search" placeholder="Search tests, files or @tags" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          <kbd className="kbd">/</kbd>
        </div>
        <div className="row">
          <Connection status={ui.status} />
          <button type="button" className="btn icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button type="button" className="btn" onClick={() => ui.send({ type: 'cancel' })} disabled={!running} title="Stop the run (Ctrl/⌘ + .)">
            <Stop size={12} />
            Stop
          </button>
          <button type="button" className="btn btn-primary" onClick={() => ui.run({ kind: 'all' })} disabled={running || ui.status !== 'open'} title={running ? 'A run is in progress: one device, one run at a time' : 'Run all tests (Ctrl/⌘ + Enter)'}>
            {running ? <Spinner size={13} strokeWidth={2.5} /> : <Play size={13} />}
            {running ? 'Running…' : 'Run all'}
          </button>
        </div>
      </header>

      {ui.status === 'closed' && (
        <div className="banner error" role="alert">
          Disconnected from quiesco ui. Reconnecting… (is <code>quiesco ui</code> still running?)
        </div>
      )}
      {ui.notices.map((n) => (
        <div key={n.id} className={`banner${n.level === 'error' ? ' error' : ''}`} role="status">
          <span className="grow">{n.message}</span>
          <button type="button" className="btn small-btn" onClick={() => ui.dismiss(n.id)}>
            Dismiss
          </button>
        </div>
      ))}
      {ui.state.phase !== 'idle' && ui.state.runner === null && !running && <NoEvents runner={info?.runner} />}

      <ProgressBand data={ui} />

      <main className="main">
        <TestTree data={ui} query={query} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} selected={selected} onSelect={setSelected} />
        <Detail data={ui} selected={selected} />
      </main>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}

function Connection({ status }: { status: UiData['status'] }) {
  const color = status === 'open' ? 'var(--passed)' : status === 'connecting' ? 'var(--skipped)' : 'var(--failed)';
  const label = status === 'open' ? 'Connected' : status === 'connecting' ? 'Connecting' : 'Disconnected';
  return (
    <span className="row muted" style={{ fontSize: 12, gap: 6, padding: '0 6px' }}>
      <span className={status === 'open' ? 'pulse' : ''} aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      {label}
    </span>
  );
}

function NoEvents({ runner }: { runner: string | undefined }) {
  const how =
    runner === 'vitest'
      ? 'Add quiescoPlugin() to the plugins of your Vitest config.'
      : runner === 'jest'
        ? "Your Jest config replaces the preset's reporters: add '@quiesco/jest/reporter'."
        : 'Install @quiesco/cucumber in this project.';
  return (
    <div className="banner" role="status">
      The run sent no test events, so the tree cannot follow it. {how}
    </div>
  );
}

const C = 2 * Math.PI * 26;
function arc(n: number, total: number, start: number) {
  const len = total > 0 ? (n / total) * C : 0;
  return { dash: `${len} ${C - len}`, offset: -start, len };
}

function ProgressBand({ data }: { data: UiData }) {
  const s: RunState = data.state;
  // A run was asked for but its runner has not reported yet (starting the device / app).
  const starting = data.running !== null && (s.phase !== 'running' || (s.startedAt ?? 0) < data.running.startedAt - 1000);
  const targetSize = data.running === null ? 0 : data.running.target.kind === 'tests' ? data.running.target.ids.length : data.running.target.kind === 'file' ? allTests(data).filter((t) => data.running?.target.kind === 'file' && t.file === data.running.target.file).length : (data.list?.tests.length ?? 0);
  const total = starting ? targetSize : s.phase === 'idle' ? (data.list?.tests.length ?? 0) : s.total;
  const done = starting || s.phase === 'idle' ? 0 : s.done;
  const c = starting ? emptyCounts() : s.counts;
  const skipped = c.skipped + c.pending + c.todo + c.undefined + c.notRun;
  const p = arc(c.passed, total, 0);
  const f = arc(c.failed, total, p.len);
  const k = arc(skipped, total, p.len + f.len);
  const running = [...s.running.values()].sort((a, b) => (a.worker ?? 0) - (b.worker ?? 0));
  const lanes = data.running !== null && running.length > 0 && (s.workers ?? 1) > 1;
  const elapsed = s.phase === 'idle' ? '' : formatMs(s.elapsedMs);
  const caption = starting
    ? 'Starting the run (device and app)…'
    : s.phase === 'idle'
      ? data.listing
        ? 'Listing tests…'
        : `${data.list?.tests.length ?? 0} tests · not run yet`
      : s.phase === 'running'
        ? `done · ${elapsed}${s.totalIsApproximate ? ' · total still growing' : ''}`
        : `${s.interrupted ? 'stopped' : s.success === true ? 'passed' : 'failed'} · ${elapsed}`;
  return (
    <section className="band" aria-label="Run progress">
      <div className="panel progress-card">
        <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${done} of ${total} tests done, ${c.failed} failed`}>
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--track)" strokeWidth="7" />
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--passed)" strokeWidth="7" strokeDasharray={p.dash} strokeDashoffset={p.offset} transform="rotate(-90 32 32)" style={{ transition: 'stroke-dasharray 200ms' }} />
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--failed)" strokeWidth="7" strokeDasharray={f.dash} strokeDashoffset={f.offset} transform="rotate(-90 32 32)" />
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--skipped)" strokeWidth="7" strokeDasharray={k.dash} strokeDashoffset={k.offset} transform="rotate(-90 32 32)" />
        </svg>
        <div role="progressbar" aria-label="Tests done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
            <span className="display big-num">{done}</span>
            <span className="display muted" style={{ fontSize: 18 }}>
              / {s.totalIsApproximate ? '~' : ''}
              {total}
            </span>
          </div>
          <span className="muted" style={{ fontSize: 13 }}>
            {caption}
          </span>
        </div>
        <div className="grow" />
        <div className="row wrap">
          <span className="status-pill" style={{ background: 'var(--passed-soft)', color: 'var(--passed)' }}>
            <Check size={13} strokeWidth={3} />
            {c.passed} passed
          </span>
          <span className="status-pill" style={{ background: 'var(--failed-soft)', color: 'var(--failed)' }}>
            <X size={13} strokeWidth={3} />
            {c.failed} failed
          </span>
          <span className="status-pill" style={{ background: 'var(--skipped-soft)', color: 'var(--skipped)' }}>
            <Skip size={13} strokeWidth={3} />
            {skipped} skipped
          </span>
        </div>
      </div>
      {lanes &&
        running.map((r) => (
          <div key={r.test.id} className="panel lane">
            <div className="row muted" style={{ fontSize: 12 }}>
              <Device size={14} />
              <span style={{ fontWeight: 600 }}>{`Device ${(r.worker ?? 0) + 1}`}</span>
              <span className="grow" />
              <span className="mono">{formatMs(Date.now() - r.startedAt)}</span>
            </div>
            <div className="row">
              <Spinner size={15} strokeWidth={2.5} className="accent" />
              <span className="ellipsis" style={{ fontWeight: 500 }}>
                {r.test.name}
              </span>
            </div>
          </div>
        ))}
    </section>
  );
}
