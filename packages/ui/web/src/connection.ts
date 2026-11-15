/**
 * The page's connection to the quiesco ui server: a WebSocket at /ws (the token comes from the URL the
 * CLI printed, then from the cookie the server set). Keeps the RunState up to date from the run events
 * and redraws at most once per animation frame. Reconnects with backoff when the server goes away.
 */
import { RunState } from '@quiesco/core/run-state';
import type { TestList } from '@quiesco/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClientMessage, RunTarget, RunningInfo, ServerMessage, UiInfo } from '../../src/messages';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface Notice {
  id: number;
  level: 'info' | 'error';
  message: string;
}

export interface UiData {
  status: ConnectionStatus;
  info: UiInfo | null;
  list: TestList | null;
  listing: boolean;
  state: RunState;
  running: RunningInfo | null;
  /** Ids of tests that started or ended in the current / last run. */
  touched: ReadonlySet<string>;
  output: string;
  notices: Notice[];
  /** Bumped on every change (memo key). */
  version: number;
}

const OUTPUT_KEEP = 200_000;

function socketUrl(): string {
  const token = new URLSearchParams(location.search).get('token');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws${token !== null ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function useUiConnection(): UiData & { send(m: ClientMessage): void; run(target: RunTarget): void; dismiss(id: number): void } {
  const store = useRef<Omit<UiData, 'version' | 'status'>>({ info: null, list: null, listing: false, state: new RunState(), running: null, touched: new Set(), output: '', notices: [] });
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const ws = useRef<WebSocket | null>(null);
  const frame = useRef<number | null>(null);
  const noticeId = useRef(0);

  const bump = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setVersion((v) => v + 1);
    });
  }, []);

  const notify = useCallback(
    (level: Notice['level'], message: string) => {
      const n = { id: ++noticeId.current, level, message };
      store.current.notices = [...store.current.notices.slice(-3), n];
      bump();
      setTimeout(() => {
        store.current.notices = store.current.notices.filter((x) => x.id !== n.id);
        bump();
      }, 8000);
    },
    [bump],
  );

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let timer: number | undefined;
    const connect = () => {
      setStatus('connecting');
      const socket = new WebSocket(socketUrl());
      ws.current = socket;
      socket.onopen = () => {
        retry = 0;
        setStatus('open');
        // The token is in the cookie now: keep it out of the address bar and the history.
        if (location.search.includes('token=')) history.replaceState(null, '', location.pathname);
      };
      socket.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as ServerMessage;
        const s = store.current;
        switch (m.type) {
          case 'welcome':
            s.info = m.info;
            s.list = m.list;
            s.listing = m.listing;
            s.state = RunState.fromSnapshot(m.state);
            s.running = m.running;
            s.output = m.output;
            s.touched = new Set([...m.state.running.map((r) => r.test.id)]);
            break;
          case 'list':
            s.list = m.list ?? s.list;
            s.listing = m.listing;
            break;
          case 'event':
            s.state.apply(m.event);
            if (m.event.type === 'run:start') s.touched = new Set();
            if (m.event.type === 'test:start' || m.event.type === 'test:end') (s.touched as Set<string>).add(m.event.test.id);
            break;
          case 'run':
            s.running = m.running;
            if (m.running !== null) {
              s.output = '';
              s.touched = new Set();
            }
            if (m.state !== undefined) s.state = RunState.fromSnapshot(m.state);
            break;
          case 'output':
            s.output = (s.output + m.text).slice(-OUTPUT_KEEP);
            break;
          case 'notice':
            notify(m.level, m.message);
            return;
        }
        bump();
      };
      socket.onclose = () => {
        ws.current = null;
        if (stopped) return;
        setStatus('closed');
        timer = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      ws.current?.close();
    };
  }, [bump, notify]);

  const send = useCallback((m: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);
  const run = useCallback((target: RunTarget) => send({ type: 'run', target }), [send]);
  const dismiss = useCallback(
    (id: number) => {
      store.current.notices = store.current.notices.filter((n) => n.id !== id);
      bump();
    },
    [bump],
  );

  return { ...store.current, status, version, send, run, dismiss };
}
