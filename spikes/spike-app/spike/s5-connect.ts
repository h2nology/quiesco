/**
 * S5 spike: resolve connection params and connect to the host over WebSocket.
 * Priority: native launch params -> web injected global / URL query -> build-time env.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Platform } from 'react-native';

import SpikeTouch from '../modules/spike-touch/src/SpikeTouchModule';

type Params = { port: string; session: string; source: string };

function resolveParams(): Params | null {
  if (Platform.OS !== 'web') {
    try {
      const p = SpikeTouch.getLaunchParams();
      console.log(`[S5] raw launch params ${JSON.stringify(p)}`);
      if (p.port && p.session) return { port: p.port, session: p.session, source: `native(${JSON.stringify(p)})` };
    } catch (e) {
      console.log(`[S5] getLaunchParams failed: ${String(e)}`);
    }
  } else {
    const g = (globalThis as any).__QUIESCO__;
    if (g?.port && g?.session) return { port: String(g.port), session: String(g.session), source: 'web-initScript' };
    const q = new URLSearchParams((globalThis as any).location?.search ?? '');
    if (q.get('quiescoPort') && q.get('quiescoSession'))
      return { port: q.get('quiescoPort')!, session: q.get('quiescoSession')!, source: 'web-query' };
  }
  const envPort = process.env.EXPO_PUBLIC_QUIESCO_PORT;
  if (envPort) return { port: envPort, session: process.env.EXPO_PUBLIC_QUIESCO_SESSION ?? 'build', source: 'build-env' };
  return null;
}

export function runS5(): void {
  const t0 = Date.now();
  const params = resolveParams();
  if (!params) {
    console.log('[S5] no params, not connecting');
    return;
  }
  const url = `ws://localhost:${params.port}`;
  console.log(`[S5] connecting ${url} source=${params.source}`);
  const ws = new WebSocket(url);
  ws.onopen = () => {
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'hello', params: { session: params.session, platform: Platform.OS, source: params.source, sinceStartMs: Date.now() - t0 } }));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.method === 'ping') ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { pong: true, at: Date.now() } }));
  };
  ws.onerror = (e: any) => console.log(`[S5] ws error ${e?.message ?? JSON.stringify(e)}`);
  ws.onclose = (e) => console.log(`[S5] ws closed code=${e.code} reason=${e.reason}`);
}
