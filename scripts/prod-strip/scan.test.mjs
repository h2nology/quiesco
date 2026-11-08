import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { countOccurrences, judge, report, scan } from './scan.mjs';

const markers = [
  { name: 'A', text: 'getIdleState' },
  { name: 'B', text: 'QuiescoNative' },
];

function artifact(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-strip-test-'));
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), data);
  }
  return dir;
}

describe('prod-strip scan', () => {
  it('counts non-overlapping occurrences, also inside binary data', () => {
    expect(countOccurrences(Buffer.from('aaaa'), Buffer.from('aa'))).toBe(2);
    expect(countOccurrences(Buffer.concat([Buffer.from([0, 1, 255]), Buffer.from('QuiescoNative'), Buffer.from([0])]), Buffer.from('QuiescoNative'))).toBe(1);
    expect(countOccurrences(Buffer.from('x'), Buffer.from(''))).toBe(0);
  });

  it('finds markers in nested files (e.g. a dex and a Hermes bundle) and names the files', () => {
    const dir = artifact({ 'classes.dex': Buffer.concat([Buffer.from([0xde, 0x0a]), Buffer.from('QuiescoNative QuiescoNative')]), 'assets/index.android.bundle': 'x getIdleState y', 'other.txt': 'nothing' });
    const hits = scan([dir], markers);
    expect(hits).toEqual([
      { marker: 'A', count: 1, files: [path.join(path.basename(dir), 'assets/index.android.bundle')] },
      { marker: 'B', count: 2, files: [path.join(path.basename(dir), 'classes.dex')] },
    ]);
  });

  it('a production build passes only without markers; the e2e control group only with all of them', () => {
    const clean = scan([artifact({ 'main.js': 'console.log(1)' })], markers);
    const full = scan([artifact({ 'main.js': 'getIdleState QuiescoNative' })], markers);
    const half = scan([artifact({ 'main.js': 'getIdleState' })], markers);
    expect(judge(clean, 'prod')).toEqual([]);
    expect(judge(full, 'e2e')).toEqual([]);
    expect(judge(full, 'prod')).toEqual([expect.stringMatching(/^A: found 1× in a production build/), expect.stringMatching(/^B: found 1×/)]);
    expect(judge(half, 'e2e')).toEqual([expect.stringMatching(/^B: missing from the e2e build \(control group\)/)]);
    expect(judge(clean, 'e2e')).toHaveLength(2);
  });

  it('fails loudly when the artifact is missing', () => {
    expect(() => scan([path.join(os.tmpdir(), 'no-such-artifact-xyz')], markers)).toThrow(/artifact not found/);
  });

  it('reports every platform × mode × marker', () => {
    const table = report([
      { platform: 'web', mode: 'prod', hits: [{ marker: 'A', count: 0, files: [] }] },
      { platform: 'web', mode: 'e2e', hits: [{ marker: 'A', count: 3, files: ['x'] }] },
      { platform: 'ios', mode: 'prod', hits: [{ marker: 'A', count: 1, files: ['x'] }] },
    ]);
    expect(table.split('\n').slice(2)).toEqual(['| web | prod | A | 0 | 0 | ✅ |', '| web | e2e | A | 3 | ≥1 | ✅ |', '| ios | prod | A | 1 | 0 | ❌ |']);
  });
});
