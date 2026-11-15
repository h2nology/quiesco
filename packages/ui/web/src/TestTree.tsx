/**
 * The test tree: files, their tests, status, duration and run buttons. An ARIA tree with one tab stop
 * (roving tabindex): ↑↓ move, ← → collapse / expand a file, Enter selects, `r` runs the focused file or
 * test.
 */
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import type { ClientMessage, RunTarget } from '../../src/messages';
import type { UiData } from './connection';
import { Alert, Chevron, FileIcon, Play, Refresh, StatusDot } from './icons';
import { useI18n } from './i18n';
import { STATUS_KEY, buildTree, formatMs } from './model';
import type { Filter, Sort } from './model';

interface Props {
  data: UiData & { run(target: RunTarget): void; send(m: ClientMessage): void };
  query: string;
  filter: Filter;
  setFilter(f: Filter): void;
  sort: Sort;
  setSort(s: Sort): void;
  selected: string | null;
  onSelect(id: string): void;
}

type Node = { kind: 'file'; key: string; file: string } | { kind: 'test'; key: string; id: string; file: string };

export function TestTree({ data, query, filter, setFilter, sort, setSort, selected, onSelect }: Props) {
  const { t } = useI18n();
  const files = useMemo(() => buildTree(data, filter, query, sort), [data, filter, query, sort]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  const running = data.running !== null;
  const counts = useMemo(() => {
    let failed = 0;
    let active = 0;
    for (const f of buildTree(data, 'all', '', 'default')) for (const x of f.tests) {
      if (x.status === 'failed') failed++;
      if (x.status === 'running' || x.status === 'queued') active++;
    }
    return { failed, active };
  }, [data]);

  // Visible nodes in order, for keyboard navigation.
  const nodes: Node[] = [];
  for (const f of files) {
    nodes.push({ kind: 'file', key: `f:${f.file}`, file: f.file });
    if (!collapsed.has(f.file)) for (const x of f.tests) nodes.push({ kind: 'test', key: `t:${x.ref.id}`, id: x.ref.id, file: f.file });
  }
  const current = focusKey !== null && nodes.some((n) => n.key === focusKey) ? focusKey : (nodes.find((n) => n.kind === 'test' && n.id === selected)?.key ?? nodes[0]?.key ?? null);

  const focusNode = (key: string) => {
    setFocusKey(key);
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus());
  };
  const toggle = (file: string, open?: boolean) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (open ?? next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const i = nodes.findIndex((n) => n.key === current);
    const node = nodes[i];
    if (node === undefined) return;
    const go = (j: number) => {
      const n = nodes[Math.max(0, Math.min(nodes.length - 1, j))];
      if (n !== undefined) focusNode(n.key);
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(nodes.length - 1);
    else if (e.key === 'ArrowRight' && node.kind === 'file') {
      if (collapsed.has(node.file)) toggle(node.file, true);
      else go(i + 1);
    } else if (e.key === 'ArrowLeft') {
      if (node.kind === 'file') toggle(node.file, false);
      else focusNode(`f:${node.file}`);
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (node.kind === 'test') onSelect(node.id);
      else toggle(node.file);
    } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !running) {
      data.run(node.kind === 'test' ? { kind: 'tests', ids: [node.id] } : { kind: 'file', file: node.file });
    } else return;
    e.preventDefault();
  };

  const filters: [Filter, string][] = [
    ['all', t('filterAll')],
    ['failed', counts.failed > 0 ? `${t('filterFailed')} ${counts.failed}` : t('filterFailed')],
    ['running', counts.active > 0 ? `${t('filterRunning')} ${counts.active}` : t('filterRunning')],
    ['skipped', t('filterSkipped')],
    ['passed', t('filterPassed')],
  ];
  const runTitle = running ? t('busyTitle') : undefined;

  return (
    <aside className="panel tree-panel" aria-label={t('tests')}>
      <div className="row wrap" style={{ padding: '12px 12px 8px' }}>
        <div className="segmented" role="group" aria-label={t('filterLabel')}>
          {filters.map(([f, label]) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <label htmlFor="sort" className="sr-only">
          {t('sort')}
        </label>
        <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ minHeight: 32, padding: '0 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 12.5 }}>
          <option value="default">{t('sortFile')}</option>
          <option value="failed">{t('sortFailed')}</option>
          <option value="slowest">{t('sortSlowest')}</option>
        </select>
        <button type="button" className="run-one" style={{ opacity: 1 }} onClick={() => data.send({ type: 'list' })} aria-label={t('relist')} title={t('relist')}>
          <Refresh size={15} className={data.listing ? 'spin' : ''} />
        </button>
      </div>

      {files.length === 0 ? (
        <div className="empty">
          {data.listing ? t('listing') : data.list === null ? t('waitingList') : query !== '' || filter !== 'all' ? t('noMatch') : t('noTests')}
          {(data.list?.errors ?? []).filter((e) => e.file === undefined).map((e, i) => (
            <pre key={i} className="mono" style={{ whiteSpace: 'pre-wrap', color: 'var(--failed)', fontSize: 12, textAlign: 'left' }}>
              {e.message}
            </pre>
          ))}
        </div>
      ) : (
         <ul className="tree" role="tree" aria-label={t('treeLabel')} ref={treeRef} onKeyDown={onKeyDown}>
          {files.map((f) => {
            const open = !collapsed.has(f.file);
            const fileKey = `f:${f.file}`;
            return (
              <li key={f.file} role="treeitem" aria-expanded={open} aria-selected={false} tabIndex={current === fileKey ? 0 : -1} data-key={fileKey} onFocus={() => setFocusKey(fileKey)} style={{ margin: '2px 0', outlineOffset: -2, borderRadius: 8 }}>
                <div className="row" style={{ paddingRight: 6 }}>
                  <button type="button" className="file-row" tabIndex={-1} onClick={() => toggle(f.file)} aria-hidden="true">
                    <Chevron open={open} size={13} className="muted" />
                    <FileIcon size={14} className="muted" />
                    <span className="grow ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>
                      {f.file}
                    </span>
                    <span className={`count mono${f.failed > 0 || f.error !== undefined ? ' bad' : ''}`}>{f.error !== undefined && f.total === 0 ? t('fileError') : `${f.done}/${f.total}`}</span>
                  </button>
                  <button type="button" className="run-one" tabIndex={-1} disabled={running} onClick={() => data.run({ kind: 'file', file: f.file })} aria-label={t('runItem', { name: f.file })} title={runTitle ?? t('runItem', { name: f.file })}>
                    <Play size={11} />
                  </button>
                </div>
                {f.error !== undefined && (
                  <div className="row" style={{ padding: '2px 8px 6px 30px', color: 'var(--failed)', fontSize: 12.5 }}>
                    <Alert size={14} />
                    <span className="ellipsis mono" title={f.error.message}>
                      {f.error.message.split('\n')[0]}
                    </span>
                  </div>
                )}
                {open && (
                  <ul role="group">
                    {f.tests.map((item) => {
                      const key = `t:${item.ref.id}`;
                      const label = `${item.ref.name}, ${t(STATUS_KEY[item.status])}${item.state?.durationMs !== undefined ? `, ${formatMs(item.state.durationMs)}` : ''}`;
                      return (
                        <li
                          key={item.ref.id}
                          role="treeitem"
                          aria-selected={item.ref.id === selected}
                          aria-label={label}
                          tabIndex={current === key ? 0 : -1}
                          data-key={key}
                          className="test-row"
                          onFocus={() => setFocusKey(key)}
                          onClick={() => {
                            onSelect(item.ref.id);
                            setFocusKey(key);
                          }}
                          style={{ cursor: 'pointer', outlineOffset: -2 }}
                        >
                          <StatusDot status={item.status} />
                          <span className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, padding: '5px 0' }}>
                            {item.groups !== '' && (
                              <span className="ellipsis faint" style={{ fontSize: 11.5 }}>
                                {item.groups}
                              </span>
                            )}
                            <span className="ellipsis test-name" style={{ color: item.status === 'idle' || item.status === 'queued' ? 'var(--muted)' : undefined }}>
                              {item.ref.name}
                            </span>
                          </span>
                          <span className="mono muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                            {formatMs(item.state?.durationMs)}
                          </span>
                          <button
                            type="button"
                            className="run-one"
                            tabIndex={-1}
                            disabled={running}
                            onClick={(e) => {
                              e.stopPropagation();
                              data.run({ kind: 'tests', ids: [item.ref.id] });
                            }}
                            aria-label={t('runItem', { name: item.ref.name })}
                            title={runTitle ?? t('runTestTitle')}
                          >
                            <Play size={11} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="hint" aria-hidden="true">
        <span>
          <kbd>↑↓</kbd> {t('hintMove')}
        </span>
        <span>
          <kbd>r</kbd> {t('hintRun')}
        </span>
        <span>
          <kbd>⌘↵</kbd> {t('hintRunAll')}
        </span>
        <span>
          <kbd>⌘.</kbd> {t('hintStop')}
        </span>
        <span>
          <kbd>/</kbd> {t('hintSearch')}
        </span>
      </div>
    </aside>
  );
}
