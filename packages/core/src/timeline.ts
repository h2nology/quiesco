/**
 * Timeline of a scenario (Phase 6.9): every call the test made on the app, how long it took and how much
 * of it was spent waiting for the app to be idle (as the agent reports it), with the error of a failed
 * call. Written as a Chrome trace (chrome://tracing, Perfetto) and a self-contained HTML summary.
 * Multi-step actions (scrollTo) carry their steps, nested in the call (issue #78).
 */
import type { StepTiming } from '@quiesco/protocol';

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
  /** What the waits for idle ended on, per tracker (issue #93). */
  syncBusy?: string[];
  /** Native calls pending when the call returned, not counted: the `native-module` tracker is off (issue #94). */
  nativeCallsNotCounted?: string[];
  /** The steps of a multi-step action, `atMs` from `start` (issue #78). */
  steps?: StepTiming[];
  error?: string;
}

/** What a call's result (or error data) says about its timing. */
export interface CallTiming {
  syncMs?: number;
  syncBusy?: string[];
  nativeCallsNotCounted?: string[];
  steps?: StepTiming[];
}

/** Said with the native calls an action did not wait for (issue #94). */
export const NOT_COUNTED_NOTE = 'pending when the call returned, not waited for: the native-module tracker is off';

/** What a call still running when the timeline is written says (issue #84). */
export const STILL_RUNNING = 'still running when the scenario ended (the test ended it first: its timeout?)';

export class Timeline {
  private entries: TimelineEntry[] = [];
  /** Calls not returned yet, with the steps the agent reported so far (issue #84). */
  private running: TimelineEntry[] = [];
  /** Bumped by reset: a call of an earlier scenario that returns late does not land in this one. */
  private generation = 0;
  private started = Date.now();
  private name = '';

  /** Start a new scenario's timeline. */
  reset(name: string): void {
    this.entries = [];
    this.running = [];
    this.generation++;
    this.started = Date.now();
    this.name = name;
  }

  add(entry: TimelineEntry): void {
    this.entries.push(entry);
    // Bounded: a runaway loop of calls must not eat the memory.
    if (this.entries.length > 5000) this.entries.shift();
  }

  /** Measure `fn` as one entry. */
  async measure<T>(method: string, label: string, fn: () => Promise<T>, timing?: (r: T) => CallTiming | undefined): Promise<T> {
    const start = Date.now();
    const running: TimelineEntry = { method, label, start, end: start, steps: [] };
    this.running.push(running);
    const generation = this.generation;
    const add = (entry: TimelineEntry): void => {
      if (generation === this.generation) this.add(entry);
    };
    try {
      const r = await fn();
      const t = timing?.(r);
      add({
        method,
        label,
        start,
        end: Date.now(),
        ...(t?.syncMs !== undefined ? { syncMs: t.syncMs } : {}),
        ...(t?.syncBusy !== undefined && t.syncBusy.length > 0 ? { syncBusy: t.syncBusy } : {}),
        ...(t?.nativeCallsNotCounted !== undefined && t.nativeCallsNotCounted.length > 0 ? { nativeCallsNotCounted: t.nativeCallsNotCounted } : {}),
        ...(t?.steps !== undefined && t.steps.length > 0 ? { steps: t.steps } : {}),
      });
      return r;
    } catch (e) {
      // A multi-step action that failed still reports its steps (issue #78).
      const steps = (e as { data?: { steps?: unknown } } | null)?.data?.steps;
      add({ method, label, start, end: Date.now(), ...(Array.isArray(steps) && steps.length > 0 ? { steps: steps as StepTiming[] } : {}), error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      this.running = this.running.filter((r) => r !== running);
    }
  }

  /** A step of the running call (calls to the agent run one at a time), reported before it returns (issue #84). */
  step(s: StepTiming): void {
    this.running.at(-1)?.steps?.push(s);
  }

  /** The calls, then those still running (ending now, with the steps so far). */
  get all(): readonly TimelineEntry[] {
    if (this.running.length === 0) return this.entries;
    const now = Date.now();
    return [...this.entries, ...this.running.map(({ steps, ...r }) => ({ ...r, end: now, ...(steps !== undefined && steps.length > 0 ? { steps: [...steps] } : {}), error: STILL_RUNNING }))];
  }

  /** Chrome trace event format: complete events ("X"), sync waits nested inside their calls. */
  toTrace(): string {
    const us = (t: number): number => Math.round((t - this.started) * 1000);
    const events: Record<string, unknown>[] = [{ name: 'process_name', ph: 'M', pid: 1, tid: 1, args: { name: `Quiesco: ${this.name}` } }];
    for (const e of this.all) {
      const args = { ...(e.error !== undefined ? { error: e.error } : {}), ...(e.nativeCallsNotCounted !== undefined ? { nativeCallsNotCounted: e.nativeCallsNotCounted, note: NOT_COUNTED_NOTE } : {}) };
      events.push({ name: `${e.method} ${e.label}`.trim(), cat: e.method, ph: 'X', ts: us(e.start), dur: Math.max(1, us(e.end) - us(e.start)), pid: 1, tid: 1, args });
      const busy = e.syncBusy !== undefined ? { busy: e.syncBusy } : {};
      if (e.steps !== undefined) {
        e.steps.forEach((s, i) => {
          const ts = us(e.start + s.atMs);
          events.push({ name: `step ${i + 1} ${s.label}`.trim(), cat: 'step', ph: 'X', ts, dur: Math.max(1, s.ms * 1000), pid: 1, tid: 1, args: { syncMs: s.syncMs } });
          if (s.syncMs > 0) events.push({ name: 'wait for idle', cat: 'sync', ph: 'X', ts: ts + Math.max(0, s.ms - s.syncMs) * 1000, dur: Math.max(1, s.syncMs * 1000), pid: 1, tid: 1 });
        });
      } else if (e.syncMs !== undefined && e.syncMs > 0) {
        events.push({ name: 'wait for idle', cat: 'sync', ph: 'X', ts: us(e.start), dur: Math.max(1, Math.round(e.syncMs * 1000)), pid: 1, tid: 1, args: busy });
      }
    }
    return JSON.stringify({ traceEvents: events, displayTimeUnit: 'ms' });
  }

  /** One page: a bar per call (sync wait shaded), failed calls in red with their message. */
  toHtml(): string {
    const entries = this.all;
    const total = Math.max(1, ...entries.map((e) => e.end - this.started));
    const rows = entries
      .map((e) => {
        const left = ((e.start - this.started) / total) * 100;
        const width = Math.max(0.3, ((e.end - e.start) / total) * 100);
        const sync = e.syncMs !== undefined ? Math.min(100, (e.syncMs / Math.max(1, e.end - e.start)) * 100) : 0;
        const cls = e.error !== undefined ? 'row failed' : 'row';
        const err = e.error !== undefined ? `<div class="err">${esc(e.error)}</div>` : '';
        const notes = [
          ...(e.syncBusy !== undefined ? [`idle wait ended on: ${e.syncBusy.join(' | ')}`] : []),
          ...(e.nativeCallsNotCounted !== undefined ? [`native calls ${NOT_COUNTED_NOTE}: ${e.nativeCallsNotCounted.join(', ')}`] : []),
        ];
        const why = notes.length > 0 ? `<div class="why">${notes.map(esc).join('<br>')}</div>` : '';
        const steps = (e.steps ?? [])
          .map((s, i) => {
            const sLeft = ((e.start + s.atMs - this.started) / total) * 100;
            const sWidth = Math.max(0.2, (s.ms / total) * 100);
            const sSync = Math.min(100, (s.syncMs / Math.max(1, s.ms)) * 100);
            return `<div class="row step"><div class="name">step ${i + 1} ${esc(s.label)}</div><div class="ms">${s.ms} ms (idle wait ${s.syncMs} ms)</div><div class="track"><div class="bar" style="left:${sLeft.toFixed(2)}%;width:${sWidth.toFixed(2)}%"><div class="sync" style="width:${sSync.toFixed(1)}%"></div></div></div></div>`;
          })
          .join('');
        return `<div class="${cls}"><div class="name">${esc(`${e.method} ${e.label}`)}</div><div class="ms">${e.end - e.start} ms${e.syncMs !== undefined ? ` (idle wait ${Math.round(e.syncMs)} ms)` : ''}</div><div class="track"><div class="bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"><div class="sync" style="width:${sync.toFixed(1)}%"></div></div></div>${why}${err}</div>${steps}`;
      })
      .join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(this.name)} — Quiesco timeline</title><style>
body{font:13px system-ui,sans-serif;margin:16px;color:#222}h1{font-size:16px}
.row{display:grid;grid-template-columns:minmax(200px,2fr) 140px 3fr;gap:8px;align-items:center;padding:2px 0;border-bottom:1px solid #eee}
.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace}.ms{color:#666;text-align:right}
.track{position:relative;height:12px;background:#f4f4f4}.bar{position:absolute;top:0;height:12px;background:#6b8de3}.sync{height:12px;background:#b9c9f3}
.step .name{padding-left:16px;color:#555}.step .bar{background:#9aa9cc}
.why{grid-column:1/-1;color:#666;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;padding:0 0 4px 16px}
.failed .bar{background:#d9534f}.failed .name{color:#c00}.err{grid-column:1/-1;color:#c00;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;padding:4px 0 6px}
</style></head><body><h1>${esc(this.name)}</h1><p>${entries.length} calls, ${total} ms. Light part of a bar: waiting for the app to be idle.</p>
${rows}
</body></html>`;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
