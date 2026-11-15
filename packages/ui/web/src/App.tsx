import type { RunState } from '@quiesco/core/run-state';
import { emptyCounts } from '@quiesco/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useUiConnection } from './connection';
import type { UiData } from './connection';
import { Detail } from './Detail';
import { LOCALES, useI18n } from './i18n';
import type { Locale, Translate } from './i18n';
import { Device, Globe, Logo, Moon, Play, Search, Spinner, Stop, Sun, Check, X, Skip } from './icons';
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
  const { t, locale, setLocale } = useI18n();
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
      setAnnounce(t('runFinished', { passed: c.passed, failed: c.failed, skipped: c.skipped + c.pending + c.todo }));
    }
    wasRunning.current = running;
  }, [running, ui.state, t]);

  const info = ui.info;
  return (
    <div className="app">
      <a className="skip-link" href="#detail">
        {t('skipToDetails')}
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
 {t('searchLabel')}
          </label>
          <input id="search" ref={searchRef} type="search" placeholder={t('searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          <kbd className="kbd">/</kbd>
        </div>
        <div className="row">
          <Connection status={ui.status} t={t} />
          <label className="lang" title={t('language')}>
            <Globe size={15} className="muted" />
            <span className="sr-only">{t('language')}</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t('language')}>
              {LOCALES.map((l) => (
                <option key={l.id} value={l.id} lang={l.htmlLang}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? t('themeToLight') : t('themeToDark')} title={theme === 'dark' ? t('themeToLight') : t('themeToDark')}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button type="button" className="btn" onClick={() => ui.send({ type: 'cancel' })} disabled={!running} title={t('stopTitle')}>
            <Stop size={12} />
            {t('stop')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => ui.run({ kind: 'all' })} disabled={running || ui.status !== 'open'} title={running ? t('busyTitle') : t('runAllTitle')}>
            {running ? <Spinner size={13} strokeWidth={2.5} /> : <Play size={13} />}
            {running ? t('running') : t('runAll')}
          </button>
        </div>
      </header>

      {ui.status === 'closed' && (
        <div className="banner error" role="alert">
          {t('disconnectedBanner')}
        </div>
      )}
      {ui.notices.map((n) => (
        <div key={n.id} className={`banner${n.level === 'error' ? ' error' : ''}`} role="status">
          <span className="grow">{n.code === 'busy' ? t('noticeBusy') : n.code === 'unknown-tests' ? t('noticeUnknownTests') : n.message}</span>
          <button type="button" className="btn small-btn" onClick={() => ui.dismiss(n.id)}>
            {t('dismiss')}
          </button>
        </div>
      ))}
      {ui.state.phase !== 'idle' && ui.state.runner === null && !running && <NoEvents runner={info?.runner} t={t} />}

      <ProgressBand data={ui} t={t} />

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

function Connection({ status, t }: { status: UiData['status']; t: Translate }) {
  const color = status === 'open' ? 'var(--passed)' : status === 'connecting' ? 'var(--skipped)' : 'var(--failed)';
  const label = status === 'open' ? t('connected') : status === 'connecting' ? t('connecting') : t('disconnected');
  return (
    <span className="row muted" style={{ fontSize: 12, gap: 6, padding: '0 6px' }}>
      <span className={status === 'open' ? 'pulse' : ''} aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      {label}
    </span>
  );
}

function NoEvents({ runner, t }: { runner: string | undefined; t: Translate }) {
  const how = runner === 'vitest' ? t('noEventsVitest') : runner === 'jest' ? t('noEventsJest') : t('noEventsCucumber');
  return (
    <div className="banner" role="status">
      {t('noEvents')} {how}
    </div>
  );
}

const C = 2 * Math.PI * 26;
function arc(n: number, total: number, start: number) {
  const len = total > 0 ? (n / total) * C : 0;
  return { dash: `${len} ${C - len}`, offset: -start, len };
}

function ProgressBand({ data, t }: { data: UiData; t: Translate }) {
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
  // From when the run was asked for (starting the device and the app included), else from the first test.
  const elapsedMs = data.lastRunStartedAt !== null ? Math.max(0, (data.running === null ? (s.endedAt ?? Date.now()) : Date.now()) - data.lastRunStartedAt) : s.elapsedMs;
  const elapsed = s.phase === 'idle' && data.running === null ? '' : formatMs(elapsedMs);
  const caption = starting
    ? `${t('starting')} · ${elapsed}`
    : s.phase === 'idle'
      ? data.listing
        ? t('listing')
        : t('notRunYetCount', { n: data.list?.tests.length ?? 0 })
      : s.phase === 'running'
        ? `${t('doneElapsed', { elapsed })}${s.totalIsApproximate ? ` · ${t('totalGrowing')}` : ''}`
        : t(s.interrupted ? 'endedStopped' : s.success === true ? 'endedPassed' : 'endedFailed', { elapsed });
  return (
    <section className="band" aria-label={t('runProgress')}>
      <div className="panel progress-card">
        <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={t('ringLabel', { done, total, failed: c.failed })}>
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--track)" strokeWidth="7" />
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--passed)" strokeWidth="7" strokeDasharray={p.dash} strokeDashoffset={p.offset} transform="rotate(-90 32 32)" style={{ transition: 'stroke-dasharray 200ms' }} />
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--failed)" strokeWidth="7" strokeDasharray={f.dash} strokeDashoffset={f.offset} transform="rotate(-90 32 32)" />
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--skipped)" strokeWidth="7" strokeDasharray={k.dash} strokeDashoffset={k.offset} transform="rotate(-90 32 32)" />
        </svg>
        <div role="progressbar" aria-label={t('testsDone')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
            {t('nPassed', { n: c.passed })}
          </span>
          <span className="status-pill" style={{ background: 'var(--failed-soft)', color: 'var(--failed)' }}>
            <X size={13} strokeWidth={3} />
            {t('nFailed', { n: c.failed })}
          </span>
          <span className="status-pill" style={{ background: 'var(--skipped-soft)', color: 'var(--skipped)' }}>
            <Skip size={13} strokeWidth={3} />
            {t('nSkipped', { n: skipped })}
          </span>
        </div>
      </div>
      {lanes &&
        running.map((r) => (
          <div key={r.test.id} className="panel lane">
            <div className="row muted" style={{ fontSize: 12 }}>
              <Device size={14} />
              <span style={{ fontWeight: 600 }}>{t('device', { n: (r.worker ?? 0) + 1 })}</span>
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
