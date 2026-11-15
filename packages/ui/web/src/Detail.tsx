/** The selected test: header, and the Report / Evidence / Console / Source tabs. */
import type { TestState } from '@quiesco/core/run-state';
import type { TestRef } from '@quiesco/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ClientMessage, RunTarget } from '../../src/messages';
import type { UiData } from './connection';
import { Alert, Device, Rerun, StatusDot } from './icons';
import { STATUS_LABEL, allTests, formatMs } from './model';
import type { RowStatus } from './model';

type Tab = 'report' | 'evidence' | 'console' | 'source';

// eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const plain = (s: string) => s.replace(ANSI, '');
const fileUrl = (p: string, kind: 'file' | 'source' = 'file') => `/api/${kind}?path=${encodeURIComponent(p)}`;
const isImage = (p: string) => /\.(png|jpe?g|webp)$/i.test(p);
const isVideo = (p: string) => /\.(mp4|webm)$/i.test(p);
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

const PILL: Record<string, [string, string]> = {
  passed: ['var(--passed-soft)', 'var(--passed)'],
  failed: ['var(--failed-soft)', 'var(--failed)'],
  running: ['var(--accent-soft)', 'var(--accent)'],
  queued: ['var(--chip)', 'var(--muted)'],
  idle: ['var(--chip)', 'var(--muted)'],
  notRun: ['var(--chip)', 'var(--muted)'],
};

interface Props {
  data: UiData & { run(target: RunTarget): void; send(m: ClientMessage): void };
  selected: string | null;
}

export function Detail({ data, selected }: Props) {
  const [tab, setTab] = useState<Tab>('report');
  const ref: TestRef | undefined = useMemo(() => allTests(data).find((t) => t.id === selected), [data, selected]);
  const st: TestState | undefined = selected !== null ? data.state.tests.get(selected) : undefined;
  const running = data.running !== null;

  if (ref === undefined) {
    return (
      <section id="detail" className="panel detail-panel" aria-label="Test details" tabIndex={-1}>
        <div className="empty" style={{ flexGrow: 1 }}>
          <span className="display" style={{ fontSize: 18, color: 'var(--fg)' }}>
            Pick a test
          </span>
          <span>Select a test in the tree to see its result, evidence, output and source. Press Run all to run everything.</span>
        </div>
      </section>
    );
  }
  const status: RowStatus = st?.status ?? 'idle';
  const [pillBg, pillFg] = PILL[status] ?? ['var(--skipped-soft)', 'var(--skipped)'];
  const evidence = st?.evidence ?? [];
  const tabs: [Tab, string, number | null][] = [
    ['report', 'Report', null],
    ['evidence', 'Evidence', evidence.length > 0 ? evidence.length : null],
    ['console', 'Console', st?.logs !== undefined && st.logs.length > 0 ? st.logs.length : null],
    ['source', 'Source', null],
  ];

  return (
    <section id="detail" className="panel detail-panel" aria-label="Test details" tabIndex={-1}>
      <div className="detail-head">
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6, flexBasis: 300 }}>
          <div className="row wrap muted" style={{ fontSize: 12 }}>
            <span className="status-pill" style={{ background: pillBg, color: pillFg, padding: '2px 9px', fontSize: 12 }}>
              <StatusDot status={status} size={14} />
              {STATUS_LABEL[status]}
            </span>
            <span className="mono">{`${ref.file}${ref.line !== undefined ? `:${ref.line}` : ''}`}</span>
            {st?.worker !== undefined && (
              <span className="row" style={{ gap: 4 }}>
                <Device size={13} />
                {`Device ${st.worker + 1}`}
              </span>
            )}
            {st?.durationMs !== undefined && <span className="mono">{formatMs(st.durationMs)}</span>}
            {st?.attempt !== undefined && st.attempt > 0 && <span>{`attempt ${st.attempt + 1}`}</span>}
          </div>
          {ref.path.length > 1 && (
            <span className="faint ellipsis" style={{ fontSize: 12.5 }}>
              {ref.path.slice(0, -1).join(' › ')}
            </span>
          )}
          <h1 className="display" style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
            {ref.name}
          </h1>
        </div>
        <button type="button" className="btn" disabled={running} onClick={() => data.run({ kind: 'tests', ids: [ref.id] })} title={running ? 'A run is in progress: one device, one run at a time' : 'Run this test again'}>
          <Rerun size={14} />
          {status === 'idle' ? 'Run' : 'Run again'}
        </button>
      </div>

      <div className="segmented" role="group" aria-label="Detail view" style={{ margin: '0 22px', alignSelf: 'flex-start' }}>
        {tabs.map(([t, label, badge]) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} style={{ minHeight: 30, padding: '0 14px', fontSize: 13 }}>
            {label}
            {badge !== null && (
              <span style={{ fontSize: 11, padding: '0 6px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)' }}>{badge}</span>
            )}
          </button>
        ))}
      </div>

      <div className="detail-body">
        {tab === 'report' && <Report status={status} st={st} openEvidence={() => setTab('evidence')} />}
        {tab === 'evidence' && <Evidence files={evidence} status={status} />}
        {tab === 'console' && <Console st={st} output={data.output} />}
        {tab === 'source' && <Source ref_={ref} st={st} />}
      </div>
    </section>
  );
}

function Report({ status, st, openEvidence }: { status: RowStatus; st: TestState | undefined; openEvidence(): void }) {
  const error = st?.error;
  if (error === undefined) {
    const text =
      status === 'passed'
        ? `Passed${st?.durationMs !== undefined ? ` in ${formatMs(st.durationMs)}` : ''}.`
        : status === 'idle'
          ? 'Not run yet in this session. Run it with the button above, or press r in the tree.'
          : status === 'running'
            ? 'Running…'
            : status === 'queued'
              ? 'Waiting for its turn in this run.'
              : `${STATUS_LABEL[status]}.`;
    return <div className="empty">{text}</div>;
  }
  const [first, ...rest] = plain(error.message).split('\n');
  const stack = error.stack !== undefined ? plain(error.stack) : undefined;
  return (
    <>
      <div className="callout" role="alert">
        <Alert size={18} className="failed-text" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ fontWeight: 600, color: 'var(--failed)' }}>{first}</span>
          {rest.length > 0 && (
            <pre className="mono" style={{ margin: 0, fontSize: 12.5, whiteSpace: 'pre-wrap' }}>
              {rest.join('\n').trim()}
            </pre>
          )}
        </div>
      </div>
      {error.diff !== undefined && (
        <div className="block">
          <div className="block-title">Difference</div>
          <pre>
            {plain(error.diff)
              .split('\n')
              .map((l, i) => (
                <span key={i} style={{ display: 'block', color: l.startsWith('-') ? 'var(--passed)' : l.startsWith('+') ? 'var(--failed)' : undefined }}>
                  {l}
                </span>
              ))}
          </pre>
        </div>
      )}
      {stack !== undefined && stack !== error.message && (
        <div className="block">
          <div className="block-title">Stack</div>
          <pre className="muted">{stack}</pre>
        </div>
      )}
      {(st?.evidence?.length ?? 0) > 0 && (
        <div className="row panel" style={{ padding: 12, gap: 14 }}>
          <div className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 600 }}>Evidence saved at the failure</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {st?.evidence?.map(baseName).join(' · ')}
            </span>
          </div>
          <button type="button" className="btn small-btn" onClick={openEvidence}>
            View evidence
          </button>
        </div>
      )}
    </>
  );
}

function Evidence({ files, status }: { files: readonly string[]; status: RowStatus }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  if (files.length === 0) {
    return <div className="empty">{status === 'failed' ? 'No evidence was saved for this failure (artifacts policy, or the run was stopped).' : 'Quiesco saves evidence (screenshot, element tree, idle state, logs) when a test fails.'}</div>;
  }
  const images = files.filter(isImage);
  const videos = files.filter(isVideo);
  const texts = files.filter((f) => !isImage(f) && !isVideo(f));
  return (
    <>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 14 }}>
        {images.map((f) => (
          <figure key={f} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              className="shot"
              aria-label={`Enlarge ${baseName(f)}`}
              onClick={() => {
                setZoom(f);
                dialog.current?.showModal();
              }}
            >
              <img src={fileUrl(f)} alt={`Screenshot: ${baseName(f)}`} loading="lazy" />
            </button>
            <figcaption className="muted mono" style={{ fontSize: 12 }}>
              {baseName(f)}
            </figcaption>
          </figure>
        ))}
        {videos.map((f) => (
          <video key={f} src={fileUrl(f)} controls style={{ maxWidth: 320, borderRadius: 12 }} aria-label={baseName(f)} />
        ))}
      </div>
      {texts.map((f) => (
        <TextFile key={f} path={f} />
      ))}
      <dialog ref={dialog} className="viewer" onClick={() => dialog.current?.close()} onClose={() => setZoom(null)} aria-label="Screenshot">
        {zoom !== null && <img src={fileUrl(zoom)} alt={`Screenshot: ${baseName(zoom)}`} />}
      </dialog>
    </>
  );
}

function TextFile({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(fileUrl(path))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (!live) return;
        try {
          setText(path.endsWith('.json') ? JSON.stringify(JSON.parse(t), null, 2) : t);
        } catch {
          setText(t);
        }
      })
      .catch(() => live && setText('(could not be read)'));
    return () => {
      live = false;
    };
  }, [path]);
  const lines = (text ?? '').split('\n');
  return (
    <div className="block">
      <div className="block-title row">
        <span className="grow mono">{baseName(path)}</span>
        <a href={fileUrl(path)} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>
      <pre style={{ maxHeight: 360 }}>{text === null ? 'Loading…' : lines.length > 400 ? `${lines.slice(0, 400).join('\n')}\n… (${lines.length - 400} more lines: Open)` : text}</pre>
    </div>
  );
}

function Console({ st, output }: { st: TestState | undefined; output: string }) {
  return (
    <>
      <div className="block">
        <div className="block-title">This test</div>
        <pre>
          {st?.logs !== undefined && st.logs.length > 0
            ? st.logs.map((l, i) => (
                <span key={i} style={{ display: 'block', color: l.stream === 'stderr' ? 'var(--skipped)' : undefined }}>
                  {plain(l.text).replace(/\n$/, '')}
                </span>
              ))
            : 'No output kept for this test (Vitest keeps console output per test; cucumber keeps this.log()).'}
        </pre>
      </div>
      <div className="block">
        <div className="block-title">Runner output (last run)</div>
        <pre style={{ maxHeight: 420 }}>{output === '' ? 'Nothing yet.' : plain(output)}</pre>
      </div>
    </>
  );
}

function Source({ ref_, st }: { ref_: TestRef; st: TestState | undefined }) {
  const [text, setText] = useState<string | null>(null);
  const container = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let live = true;
    setText(null);
    fetch(fileUrl(ref_.file, 'source'))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => live && setText(t))
      .catch(() => live && setText(''));
    return () => {
      live = false;
    };
  }, [ref_.file]);
  // The failing line, when the stack points into this file.
  const failingLine = useMemo(() => {
    const stack = plain(`${st?.error?.stack ?? ''}\n${st?.error?.message ?? ''}`);
    const m = new RegExp(`${ref_.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`).exec(stack);
    return m !== null ? Number(m[1]) : undefined;
  }, [st, ref_.file]);
  useEffect(() => {
    const line = failingLine ?? ref_.line;
    if (text !== null && line !== undefined) container.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center' });
  }, [text, failingLine, ref_.line]);
  if (text === null) return <div className="empty">Loading {ref_.file}…</div>;
  if (text === '') return <div className="empty">{`${ref_.file} could not be read.`}</div>;
  return (
    <div className="block">
      <div className="block-title mono">{`${ref_.file} · read-only`}</div>
      <pre ref={container} style={{ padding: '0 0 12px', maxHeight: 'calc(100vh - 420px)', overflow: 'auto' }}>
        {text.split('\n').map((l, i) => {
          const n = i + 1;
          const cls = n === failingLine ? 'src-line hit' : n === ref_.line ? 'src-line focus' : 'src-line';
          return (
            <span key={n} className={cls} data-line={n}>
              <span className="src-no">{n}</span>
              {l === '' ? ' ' : l}
            </span>
          );
        })}
      </pre>
    </div>
  );
}
