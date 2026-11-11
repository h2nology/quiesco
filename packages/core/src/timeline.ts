/**
 * Timeline of a scenario (Phase 6.9): every call the test made on the app, how long it took and how much
 * of it was spent waiting for the app to be idle (as the agent reports it), with the error of a failed
 * call. Written as a Chrome trace (chrome://tracing, Perfetto) and a self-contained HTML summary.
 */

export interface TimelineEntry {
  /** The agent method (`action`, `assert`, ...) or a device call (`device.relaunch`). */
  method: string;
  /** What it was about: `tap { id: "save" }`, `text { id: "title" }`. */
  label: string;
  /** ms since the epoch. */
  start: number;
  end: number;
  /** Of which waiting for idle in the agent. */
  syncMs?: number;
  error?: string;
}

export class Timeline {
  private entries: TimelineEntry[] = [];
  private started = Date.now();
  private name = '';

  /** Start a new scenario's timeline. */
  reset(name: string): void {
    this.entries = [];
    this.started = Date.now();
    this.name = name;
  }

  add(entry: TimelineEntry): void {
    this.entries.push(entry);
    // Bounded: a runaway loop of calls must not eat the memory.
    if (this.entries.length > 5000) this.entries.shift();
  }

  /** Measure `fn` as one entry. */
  async measure<T>(method: string, label: string, fn: () => Promise<T>, syncMs?: (r: T) => number | undefined): Promise<T> {
    const start = Date.now();
    try {
      const r = await fn();
      const s = syncMs?.(r);
      this.add({ method, label, start, end: Date.now(), ...(s !== undefined ? { syncMs: s } : {}) });
      return r;
    } catch (e) {
      this.add({ method, label, start, end: Date.now(), error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  get all(): readonly TimelineEntry[] {
    return this.entries;
  }

  /** Chrome trace event format: complete events ("X"), sync waits nested inside their calls. */
  toTrace(): string {
    const us = (t: number): number => Math.round((t - this.started) * 1000);
    const events: Record<string, unknown>[] = [{ name: 'process_name', ph: 'M', pid: 1, tid: 1, args: { name: `Quiesco: ${this.name}` } }];
    for (const e of this.entries) {
      events.push({ name: `${e.method} ${e.label}`.trim(), cat: e.method, ph: 'X', ts: us(e.start), dur: Math.max(1, us(e.end) - us(e.start)), pid: 1, tid: 1, args: e.error !== undefined ? { error: e.error } : {} });
      if (e.syncMs !== undefined && e.syncMs > 0) {
        events.push({ name: 'wait for idle', cat: 'sync', ph: 'X', ts: us(e.start), dur: Math.max(1, Math.round(e.syncMs * 1000)), pid: 1, tid: 1 });
      }
    }
    return JSON.stringify({ traceEvents: events, displayTimeUnit: 'ms' });
  }

  /** One page: a bar per call (sync wait shaded), failed calls in red with their message. */
  toHtml(): string {
    const total = Math.max(1, ...this.entries.map((e) => e.end - this.started));
    const rows = this.entries
      .map((e) => {
        const left = ((e.start - this.started) / total) * 100;
        const width = Math.max(0.3, ((e.end - e.start) / total) * 100);
        const sync = e.syncMs !== undefined ? Math.min(100, (e.syncMs / Math.max(1, e.end - e.start)) * 100) : 0;
        const cls = e.error !== undefined ? 'row failed' : 'row';
        const err = e.error !== undefined ? `<div class="err">${esc(e.error)}</div>` : '';
        return `<div class="${cls}"><div class="name">${esc(`${e.method} ${e.label}`)}</div><div class="ms">${e.end - e.start} ms${e.syncMs !== undefined ? ` (idle wait ${Math.round(e.syncMs)} ms)` : ''}</div><div class="track"><div class="bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"><div class="sync" style="width:${sync.toFixed(1)}%"></div></div></div>${err}</div>`;
      })
      .join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(this.name)} — Quiesco timeline</title><style>
body{font:13px system-ui,sans-serif;margin:16px;color:#222}h1{font-size:16px}
.row{display:grid;grid-template-columns:minmax(200px,2fr) 140px 3fr;gap:8px;align-items:center;padding:2px 0;border-bottom:1px solid #eee}
.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace}.ms{color:#666;text-align:right}
.track{position:relative;height:12px;background:#f4f4f4}.bar{position:absolute;top:0;height:12px;background:#6b8de3}.sync{height:12px;background:#b9c9f3}
.failed .bar{background:#d9534f}.failed .name{color:#c00}.err{grid-column:1/-1;color:#c00;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;padding:4px 0 6px}
</style></head><body><h1>${esc(this.name)}</h1><p>${this.entries.length} calls, ${total} ms. Light part of a bar: waiting for the app to be idle.</p>
${rows}
</body></html>`;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
