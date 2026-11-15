/** The selected test: header, and the Report / Evidence / Console / Source tabs. */
import type { TestState } from '@quiesco/core/run-state';
import type { TestRef } from '@quiesco/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ClientMessage, RunTarget } from '../../src/messages';
import type { UiData } from './connection';
import { Alert, Device, Rerun, StatusDot } from './icons';
import { useI18n } from './i18n';
import type { Translate } from './i18n';
import { STATUS_KEY, allTests, formatMs } from './model';
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
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('report');
  const ref: TestRef | undefined = useMemo(() => allTests(data).find((t) => t.id === selected), [data, selected]);
  const st: TestState | undefined = selected !== null ? data.state.tests.get(selected) : undefined;
  const running = data.running !== null;

  if (ref === undefined) {
    return (
      <section id="detail" className="panel detail-panel" aria-label={t('testDetails')} tabIndex={-1}>
        <div className="empty" style={{ flexGrow: 1 }}>
          <span className="display" style={{ fontSize: 18, color: 'var(--fg)' }}>
            {t('pickTest')}
          </span>
          <span>{t('pickTestHelp')}</span>
        </div>
      </section>
    );
  }
  const status: RowStatus = st?.status ?? 'idle';
  const [pillBg, pillFg] = PILL[status] ?? ['var(--skipped-soft)', 'var(--skipped)'];
  const evidence = st?.evidence ?? [];
  const tabs: [Tab, string, number | null][] = [
    ['report', t('tabReport'), null],
    ['evidence', t('tabEvidence'), evidence.length > 0 ? evidence.length : null],
    ['console', t('tabConsole'), st?.logs !== undefined && st.logs.length > 0 ? st.logs.length : null],
    ['source', t('tabSource'), null],
  ];

  return (
    <section id="detail" className="panel detail-panel" aria-label={t('testDetails')} tabIndex={-1}>
      <div className="detail-head">
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6, flexBasis: 300 }}>
          <div className="row wrap muted" style={{ fontSize: 12 }}>
            <span className="status-pill" style={{ background: pillBg, color: pillFg, padding: '2px 9px', fontSize: 12 }}>
              <StatusDot status={status} size={14} />
              {t(STATUS_KEY[status])}
            </span>
            <span className="mono">{`${ref.file}${ref.line !== undefined ? `:${ref.line}` : ''}`}</span>
            {st?.worker !== undefined && (
              <span className="row" style={{ gap: 4 }}>
                <Device size={13} />
                {t('device', { n: st.worker + 1 })}
              </span>
            )}
            {st?.durationMs !== undefined && <span className="mono">{formatMs(st.durationMs)}</span>}
            {st?.attempt !== undefined && st.attempt > 0 && <span>{t('attempt', { n: st.attempt + 1 })}</span>}
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
        <button type="button" className="btn" disabled={running} onClick={() => data.run({ kind: 'tests', ids: [ref.id] })} title={running ? t('busyTitle') : t('runAgainTitle')}>
          <Rerun size={14} />
          {status === 'idle' ? t('run') : t('runAgain')}
        </button>
      </div>

      <div className="segmented" role="group" aria-label={t('detailView')} style={{ margin: '0 22px', alignSelf: 'flex-start' }}>
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
        {tab === 'report' && <Report status={status} st={st} openEvidence={() => setTab('evidence')} t={t} />}
        {tab === 'evidence' && <Evidence files={evidence} status={status} t={t} />}
        {tab === 'console' && <Console st={st} output={data.output} t={t} />}
        {tab === 'source' && <Source ref_={ref} st={st} t={t} />}
      </div>
    </section>
  );
}

function Report({ status, st, openEvidence, t }: { status: RowStatus; st: TestState | undefined; openEvidence(): void; t: Translate }) {
  const error = st?.error;
  if (error === undefined) {
    const text =
      status === 'passed'
        ? st?.durationMs !== undefined
          ? t('passedIn', { d: formatMs(st.durationMs) })
          : t('passedPlain')
        : status === 'idle'
          ? t('notRunHelp')
          : status === 'running'
            ? t('running')
            : status === 'queued'
              ? t('waitingTurn')
              : t(STATUS_KEY[status]);
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
          <div className="block-title">{t('difference')}</div>
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
          <div className="block-title">{t('stack')}</div>
          <pre className="muted">{stack}</pre>
        </div>
      )}
      {(st?.evidence?.length ?? 0) > 0 && (
        <div className="row panel" style={{ padding: 12, gap: 14 }}>
          <div className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 600 }}>{t('evidenceSaved')}</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {st?.evidence?.map(baseName).join(' · ')}
            </span>
          </div>
          <button type="button" className="btn small-btn" onClick={openEvidence}>
            {t('viewEvidence')}
          </button>
        </div>
      )}
    </>
  );
}

function Evidence({ files, status, t }: { files: readonly string[]; status: RowStatus; t: Translate }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  if (files.length === 0) {
    return <div className="empty">{status === 'failed' ? t('noEvidenceFailed') : t('evidenceHelp')}</div>;
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
              aria-label={t('enlarge', { file: baseName(f) })}
              onClick={() => {
                setZoom(f);
                dialog.current?.showModal();
              }}
            >
              <img src={fileUrl(f)} alt={t('screenshotOf', { file: baseName(f) })} loading="lazy" />
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
        <TextFile key={f} path={f} t={t} />
      ))}
      <dialog ref={dialog} className="viewer" onClick={() => dialog.current?.close()} onClose={() => setZoom(null)} aria-label={t('screenshot')}>
        {zoom !== null && <img src={fileUrl(zoom)} alt={t('screenshotOf', { file: baseName(zoom) })} />}
      </dialog>
    </>
  );
}

function TextFile({ path, t }: { path: string; t: Translate }) {
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
      .catch(() => live && setText(t('unreadable')));
    return () => {
      live = false;
    };
  }, [path, t]);
  const lines = (text ?? '').split('\n');
  return (
    <div className="block">
      <div className="block-title row">
        <span className="grow mono">{baseName(path)}</span>
        <a href={fileUrl(path)} target="_blank" rel="noreferrer">
          {t('open')}
        </a>
      </div>
      <pre style={{ maxHeight: 360 }}>{text === null ? t('loading') : lines.length > 400 ? `${lines.slice(0, 400).join('\n')}\n${t('moreLines', { n: lines.length - 400 })}` : text}</pre>
    </div>
  );
}

function Console({ st, output, t }: { st: TestState | undefined; output: string; t: Translate }) {
  return (
    <>
      <div className="block">
        <div className="block-title">{t('thisTest')}</div>
        <pre>
          {st?.logs !== undefined && st.logs.length > 0
            ? st.logs.map((l, i) => (
                <span key={i} style={{ display: 'block', color: l.stream === 'stderr' ? 'var(--skipped)' : undefined }}>
                  {plain(l.text).replace(/\n$/, '')}
                </span>
              ))
            : t('noTestOutput')}
        </pre>
      </div>
      <div className="block">
        <div className="block-title">{t('runnerOutput')}</div>
        <pre style={{ maxHeight: 420 }}>{output === '' ? t('nothingYet') : plain(output)}</pre>
      </div>
    </>
  );
}

function Source({ ref_, st, t }: { ref_: TestRef; st: TestState | undefined; t: Translate }) {
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
  if (text === null) return <div className="empty">{t('loadingFile', { file: ref_.file })}</div>;
  if (text === '') return <div className="empty">{t('fileUnreadable', { file: ref_.file })}</div>;
  return (
    <div className="block">
      <div className="block-title mono">{t('readOnly', { file: ref_.file })}</div>
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
