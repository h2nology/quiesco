import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Rect, ScrollViewInfo } from '@quiesco/protocol';

import { Artifacts, resolveArtifacts, slug } from '../src/artifacts';
import { LogBuffer } from '../src/devices/streams';
import { decodePng, drawRects, encodePng, stackPng } from '../src/png';
import { failureRects, fullElementScreenshot, fullPageScreenshot, highlight } from '../src/screenshots';
import type { ScreenshotHost } from '../src/screenshots';
import { Timeline } from '../src/timeline';
import { FakeProvider } from './helpers/fake-provider';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** An RGB image whose pixel at (x, y) is `color(x, y)`. */
function image(width: number, height: number, color: (x: number, y: number) => [number, number, number]): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(color(x, y), (y * width + x) * 3);
  return encodePng({ width, height, channels: 3, pixels });
}
const px = (png: Buffer, x: number, y: number): number[] => {
  const img = decodePng(png);
  const o = (y * img.width + x) * img.channels;
  return [...img.pixels.subarray(o, o + 3)];
};

describe('png drawing and stacking', () => {
  it('frames rects, clipped to the image', () => {
    const out = drawRects(image(20, 20, () => [0, 0, 0]), [{ x: 5, y: 5, width: 10, height: 10 }, { x: 15, y: 15, width: 20, height: 20 }], [255, 0, 0], 1);
    expect(px(out, 5, 5)).toEqual([255, 0, 0]);
    expect(px(out, 14, 10)).toEqual([255, 0, 0]);
    expect(px(out, 10, 10)).toEqual([0, 0, 0]);
    expect(px(out, 19, 15)).toEqual([255, 0, 0]);
  });

  it('stacks strips of the same width, mixing RGB and RGBA', () => {
    const a = image(4, 10, (_x, y) => [y, 0, 0]);
    const rgba = encodePng({ width: 4, height: 10, channels: 4, pixels: Buffer.alloc(4 * 10 * 4, 200) });
    const out = stackPng([{ png: a, from: 2, to: 5 }, { png: rgba, from: 0, to: 2 }]);
    const img = decodePng(out);
    expect([img.width, img.height, img.channels]).toEqual([4, 5, 4]);
    expect(px(out, 0, 0)).toEqual([2, 0, 0]);
    expect(px(out, 0, 4)).toEqual([200, 200, 200]);
    expect(() => stackPng([{ png: a, from: 0, to: 1 }, { png: image(5, 2, () => [0, 0, 0]), from: 0, to: 1 }])).toThrow(/different widths/);
  });
});

/**
 * A screen 100 wide (PNG 200 px: scale 2): a header (y 0–50), a scroll view (y 50–250) showing content
 * whose row y has red = y / 2 % 256 and green = floor(y / 512), and a footer (250–300).
 */
function fakeScreen(contentHeight: number, opts: { growTo?: number } = {}) {
  let offset = 37;
  let height = contentHeight;
  const rect: Rect = { x: 0, y: 50, width: 100, height: 200 };
  const shots: number[] = [];
  const info = (): ScrollViewInfo => ({ rect, offset: { x: 0, y: offset }, content: { width: 100, height } });
  const host: ScreenshotHost = {
    windowWidth: async () => 100,
    screenshot: async () => {
      shots.push(offset);
      return image(200, 600, (_x, py) => {
        const y = py / 2;
        if (y < 50) return [0, 0, 250];
        if (y >= 250) return [0, 250, 0];
        const c = Math.floor((y - 50 + offset) * 2);
        return [c % 256, Math.floor(c / 512), 0];
      });
    },
    scrollView: async (_m, to) => {
      if (to !== undefined) {
        offset = Math.max(0, Math.min(to.y, height - rect.height));
        // A virtualized list renders more rows once scrolled near its end.
        if (opts.growTo !== undefined && offset >= height - rect.height) height = Math.min(opts.growTo, height + 300);
      }
      return info();
    },
  };
  return { host, shots, offset: () => offset };
}

describe('full-page screenshots', () => {
  it('stitches header, all content and footer once each, and restores the scroll position', async () => {
    const s = fakeScreen(650);
    const png = await fullPageScreenshot(s.host);
    const img = decodePng(png);
    // header 50 + content 650 + footer 50, at scale 2.
    expect([img.width, img.height]).toEqual([200, 1500]);
    expect(px(png, 10, 20)).toEqual([0, 0, 250]);
    expect(px(png, 10, 1480)).toEqual([0, 250, 0]);
    // Content row y is on image row 2 * (50 + y).
    for (const y of [0, 199, 200, 333, 449, 450, 649]) {
      const c = y * 2;
      expect(px(png, 10, 2 * (50 + y)), `content row ${y}`).toEqual([c % 256, Math.floor(c / 512), 0]);
    }
    expect(s.offset()).toBe(37);
    expect(s.shots).toEqual([0, 200, 400, 450]);
  });

  it('follows a list that grows while it is scrolled', async () => {
    const s = fakeScreen(400, { growTo: 1000 });
    const img = decodePng(await fullPageScreenshot(s.host));
    expect(img.height).toBe(2 * (50 + 1000 + 50));
  });

  it('a scroll view element in full is all of its content; a fully visible element is cropped from the screen', async () => {
    const s = fakeScreen(650);
    const whole = decodePng(await fullElementScreenshot(s.host, { id: 'list' }, { x: 0, y: 50, width: 100, height: 200 }));
    expect([whole.width, whole.height]).toEqual([200, 1300]);
    const shotsBefore = s.shots.length;
    const small = decodePng(await fullElementScreenshot(s.host, { id: 'row' }, { x: 10, y: 60, width: 20, height: 30 }));
    expect([small.width, small.height]).toEqual([40, 60]);
    expect(s.shots.length).toBe(shotsBefore + 1);
  });

  it('an element taller than the screen is cut out of the stitched page', async () => {
    const s = fakeScreen(650);
    // At offset 37, the element at content y 100–500 is at window y 113.
    const png = await fullElementScreenshot(s.host, { id: 'tall' }, { x: 10, y: 113, width: 50, height: 400 });
    const img = decodePng(png);
    expect([img.width, img.height]).toEqual([100, 800]);
    expect(px(png, 0, 0)).toEqual([200, 0, 0]);
    const c = 499 * 2;
    expect(px(png, 0, 798)).toEqual([c % 256, Math.floor(c / 512), 0]);
  });
});

describe('failure highlight', () => {
  it('collects rects from the error data and frames them at the screenshot scale', () => {
    const rects = failureRects({ element: { rect: { x: 1, y: 2, width: 3, height: 4 } }, matches: [{ rect: { x: 5, y: 5, width: 10, height: 10 } }, { rect: null }], elements: [{ rect: { x: 0, y: 0, width: 0, height: 5 } }] });
    expect(rects).toEqual([{ x: 1, y: 2, width: 3, height: 4 }, { x: 5, y: 5, width: 10, height: 10 }]);
    expect(failureRects(undefined)).toEqual([]);
    const out = highlight(image(40, 40, () => [0, 0, 0]), [{ x: 5, y: 5, width: 10, height: 10 }], 20);
    expect(px(out, 10, 10)).toEqual([255, 0, 0]);
    expect(px(out, 20, 20)).toEqual([0, 0, 0]);
  });
});

describe('timeline', () => {
  it('records calls with their idle wait and errors; writes a trace and an HTML page', async () => {
    const t = new Timeline();
    t.reset('保存 <b>');
    await t.measure('action', 'tap {"id":"save"}', async () => ({ syncMs: 12 }), (r) => r.syncMs);
    await expect(t.measure('assert', 'text', async () => Promise.reject(new Error('expected "a"')))).rejects.toThrow();
    expect(t.all.map((e) => [e.method, e.syncMs, e.error])).toEqual([
      ['action', 12, undefined],
      ['assert', undefined, 'expected "a"'],
    ]);
    const trace = JSON.parse(t.toTrace()) as { traceEvents: { name: string; ph: string }[] };
    expect(trace.traceEvents.map((e) => e.name)).toEqual(['process_name', 'action tap {"id":"save"}', 'wait for idle', 'assert text']);
    const html = t.toHtml();
    expect(html).toContain('保存 &lt;b&gt;');
    expect(html).toContain('class="row failed"');
    expect(html).toContain('expected &quot;a&quot;');
  });
});

describe('artifacts', () => {
  it('resolves policies (QUIESCO_ARTIFACTS wins) and makes safe names', () => {
    expect(resolveArtifacts(undefined, {})).toEqual({ dir: 'artifacts', video: 'none', logs: 'failing', timeline: 'failing' });
    expect(resolveArtifacts({ video: 'failing' }, { QUIESCO_ARTIFACTS: 'all' })).toMatchObject({ video: 'all', logs: 'all', timeline: 'all' });
    expect(() => resolveArtifacts({ video: 'always' as never }, {})).toThrow(/artifacts.video/);
    expect(slug('添加 / 删除: "待办"?')).toBe('添加-删除-待办');
    expect(slug('...')).toBe('scenario');
  });

  function setup(config: Parameters<typeof resolveArtifacts>[0]) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-artifacts-'));
    const provider = new FakeProvider();
    const logs = new LogBuffer();
    const videos: string[] = [];
    Object.assign(provider, {
      startVideo: async (base: string) => void videos.push(base),
      stopVideo: async () => {
        const f = `${videos.at(-1)}.mp4`;
        fs.writeFileSync(f, 'mp4');
        return [f];
      },
      startDeviceLogs: async () => undefined,
      deviceLogs: (since: number) => logs.since(since),
    });
    const a = new Artifacts({ config: { dir: 'out', ...config }, provider, logger: silent, env: {}, cwd });
    return { a, cwd, logs, videos };
  }
  const files = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).sort() : []);

  it('failing: keeps video, log and timeline of failed scenarios only; saved screenshots always', async () => {
    const { a, cwd, logs } = setup({ video: 'failing' });
    await a.beginScenario('passes');
    logs.push('I ok');
    await a.timeline.measure('action', 'tap', async () => ({}));
    const shot = await a.save('首页', Buffer.from('png'), 'image/png', '.png');
    const passed = await a.endScenario({ failed: false });
    expect(passed.attachments.map((x) => x.fileName)).toEqual(['首页.png']);
    expect(fs.existsSync(shot)).toBe(true);

    await a.beginScenario('fails');
    logs.push('E boom');
    await a.timeline.measure('assert', 'text', async () => ({}));
    const failed = await a.endScenario({ failed: true, evidence: [{ data: Buffer.from('png'), mediaType: 'image/png', fileName: 'failure.png' }] });
    expect(failed.attachments.map((x) => x.fileName ?? x.mediaType)).toEqual(['failure.png', 'text/plain', 'device.log', 'timeline.html', 'text/plain']);
    expect(String(failed.attachments[2]?.data)).toBe('E boom');
    const all = files(path.join(cwd, 'out'));
    expect(all.filter((f) => f.includes('001-passes'))).toEqual([expect.stringMatching(/001-passes$/), expect.stringMatching(/001-passes\/首页\.png$/)]);
    expect(all.filter((f) => f.includes('002-fails/')).map((f) => path.basename(f))).toEqual(['device.log', 'failure.png', 'timeline.html', 'timeline.trace.json', 'video.mp4']);
  });

  it('none: no video started, no directory left behind', async () => {
    const { a, cwd, videos } = setup({ video: 'none', logs: 'none', timeline: 'none' });
    await a.beginScenario('x');
    expect((await a.endScenario({ failed: true })).attachments).toEqual([]);
    expect(videos).toEqual([]);
    expect(files(path.join(cwd, 'out')).filter((f) => f.includes('001-x'))).toEqual([]);
  });
});

describe('LogBuffer', () => {
  it('splits chunks into lines, keeps unfinished ones, filters by time and bounds its size', () => {
    let now = 0;
    const b = new LogBuffer(3, () => now);
    b.write('a\nb');
    now = 10;
    b.write('c\n\nd\n');
    b.push('e');
    expect(b.since(0)).toEqual(['bc', 'd', 'e']);
    expect(b.since(5)).toEqual(['bc', 'd', 'e']);
    now = 20;
    b.push('f');
    expect(b.since(15)).toEqual(['f']);
    expect(b.since(0)).toEqual(['d', 'e', 'f']);
  });
});
