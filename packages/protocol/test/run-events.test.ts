import { describe, expect, expectTypeOf, it } from 'vitest';

import { createRunEventDecoder, encodeRunEvent, isRunEvent } from '../src/index.js';
import type { RunEvent, RunEventOf } from '../src/index.js';

const test = { id: 'features/a.feature:3', file: 'features/a.feature', line: 3, name: 'adds a todo', path: ['Todos', 'adds a todo'] };
const start: RunEvent = { type: 'test:start', test, attempt: 0, startedAt: 1 };
const end: RunEvent = { type: 'test:end', test, status: 'failed', durationMs: 12, error: { message: 'line 1\nline 2 "quoted"' }, willRetry: false };

function decodeAll(chunks: readonly string[], finish = true) {
  const events: RunEvent[] = [];
  const invalid: string[] = [];
  const d = createRunEventDecoder(
    (e) => events.push(e),
    (line) => invalid.push(line),
  );
  for (const c of chunks) d.push(c);
  if (finish) d.end();
  return { events, invalid };
}

describe('run events NDJSON', () => {
  it('encodes one event per line, newlines in strings escaped', () => {
    const line = encodeRunEvent(end);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(decodeAll([line]).events).toEqual([end]);
  });

  it('reassembles events split across chunks and several events in one chunk', () => {
    const text = encodeRunEvent(start) + encodeRunEvent(end);
    const cut = [text.slice(0, 5), text.slice(5, 40), text.slice(40)];
    expect(decodeAll(cut).events).toEqual([start, end]);
  });

  it('decodes a last line without a newline only at end()', () => {
    const text = encodeRunEvent(start).trimEnd();
    expect(decodeAll([text], false).events).toEqual([]);
    expect(decodeAll([text]).events).toEqual([start]);
  });

  it('skips lines that are not JSON or not a known event, and keeps going', () => {
    const { events, invalid } = decodeAll(['not json\n', '{"type":"from-the-future"}\n', '\n', encodeRunEvent(start)]);
    expect(events).toEqual([start]);
    expect(invalid).toEqual(['not json', '{"type":"from-the-future"}']);
  });

  it('isRunEvent checks the type tag', () => {
    expect(isRunEvent(start)).toBe(true);
    expect(isRunEvent({ type: 'nope' })).toBe(false);
    expect(isRunEvent(null)).toBe(false);
  });

  it('RunEvent is a union discriminated by type', () => {
    expectTypeOf<RunEventOf<'run:start'>>().toHaveProperty('totalIsEstimate');
    // @ts-expect-error test:end needs a status
    const bad: RunEvent = { type: 'test:end', test, durationMs: 1, willRetry: false };
    void bad;
    // @ts-expect-error notRun is never sent
    const notRun: RunEvent = { type: 'test:end', test, status: 'notRun', durationMs: 1, willRetry: false };
    void notRun;
  });
});
