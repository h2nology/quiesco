/**
 * Screenshots beyond one screen (Phase 6.9, HU 2026-11-10): the whole content of a scroll view, stitched
 * from one screenshot per screenful, and elements larger than the screen; plus frames drawn around
 * elements (failure screenshots). Same on every platform: the agent scrolls the scroll view
 * programmatically (findings 6.9), core stitches with png.ts.
 */
import type { Matcher, Rect, ScrollViewInfo } from '@quiesco/protocol';

import { cropPng, drawRects, pngSize, stackPng } from './png.js';
import type { PngStrip } from './png.js';

export interface ScreenshotHost {
  /** The screen as a PNG. */
  screenshot(): Promise<Buffer>;
  /** The app window's width in logical units (to scale rects to screenshot pixels). */
  windowWidth(): Promise<number>;
  /**
   * The scroll view containing `matcher` (default: the largest one on screen), scrolled to `to` when given;
   * `indicators` shows / hides its scroll indicators.
   */
  scrollView(matcher: Matcher | undefined, to?: { x: number; y: number }, indicators?: boolean): Promise<ScrollViewInfo>;
}

/** Screenfuls at most (a virtualized list that keeps growing ends here). */
const MAX_SCREENS = 60;

/**
 * The whole content of the scroll view: scrolled to the top, then a screenful at a time; the first
 * screenshot gives everything above the scroll view's bottom edge (headers included), every next one the
 * strip it newly revealed, the last one what is below the scroll view (tab bars). Fixed headers / footers
 * thus appear once. The scroll position is restored afterwards.
 */
export async function fullPageScreenshot(host: ScreenshotHost, container?: Matcher): Promise<Buffer> {
  // Indicators hidden: they are drawn for a while after each scroll (Android) and would repeat in every strip.
  const start = await host.scrollView(container, undefined, false);
  try {
    const width = await host.windowWidth();
    let info = await host.scrollView(container, { x: start.offset.x, y: 0 });
    let png = await host.screenshot();
    const size = pngSize(png);
    const scale = size.width / width;
    const bottom = Math.round((info.rect.y + info.rect.height) * scale);
    const strips: PngStrip[] = [{ png, from: 0, to: bottom }];
    for (let i = 0; i < MAX_SCREENS; i++) {
      const next = await host.scrollView(container, { x: start.offset.x, y: info.offset.y + info.rect.height });
      const delta = next.offset.y - info.offset.y;
      if (delta < 0.5) break;
      png = await host.screenshot();
      strips.push({ png, from: bottom - Math.round(delta * scale), to: bottom });
      info = next;
    }
    strips.push({ png, from: bottom, to: size.height });
    return stackPng(strips.filter((s) => s.to > s.from));
  } finally {
    await host.scrollView(container, start.offset, start.indicatorsWere).catch(() => undefined);
  }
}

/**
 * All of an element: a scroll view (the element itself) with its whole content, or an element only partly
 * inside its scroll view's visible area, cut out of the stitched image of that scroll view (content rows
 * map linearly onto it). An element already fully visible, or outside any scroll view, is cropped from the
 * screen.
 */
export async function fullElementScreenshot(host: ScreenshotHost, target: Matcher, rect: Rect): Promise<Buffer> {
  const width = await host.windowWidth();
  const sv = await host.scrollView(target).catch(() => null);
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1;
  const isContainer = sv !== null && near(rect.x, sv.rect.x) && near(rect.y, sv.rect.y) && near(rect.width, sv.rect.width) && near(rect.height, sv.rect.height);
  let contentY: number;
  let height: number;
  if (sv === null) return cropToRect(await host.screenshot(), rect, width);
  if (isContainer) {
    if (sv.content.height <= sv.rect.height + 0.5) return cropToRect(await host.screenshot(), rect, width);
    contentY = 0;
    height = sv.content.height;
  } else {
    if (rect.y >= sv.rect.y - 0.5 && rect.y + rect.height <= sv.rect.y + sv.rect.height + 0.5) return cropToRect(await host.screenshot(), rect, width);
    contentY = rect.y - sv.rect.y + sv.offset.y;
    height = rect.height;
  }
  const page = await fullPageScreenshot(host, target);
  const scale = pngSize(page).width / width;
  // On the stitched image (taken from offset 0) content row y is at window row sv.rect.y + y.
  return cropPng(page, { x: rect.x * scale, y: (sv.rect.y + contentY) * scale, width: rect.width * scale, height: height * scale });
}

/** The element as far as it is on screen. */
export function cropToRect(png: Buffer, rect: Rect, windowWidth: number): Buffer {
  const scale = pngSize(png).width / windowWidth;
  return cropPng(png, { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale });
}

/** Red frames around `rects` (window coordinates). */
export function highlight(png: Buffer, rects: readonly Rect[], windowWidth: number): Buffer {
  if (rects.length === 0) return png;
  const scale = pngSize(png).width / windowWidth;
  const thickness = Math.max(2, Math.round(2 * scale));
  return drawRects(
    png,
    rects.map((r) => ({ x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale })),
    [255, 0, 0],
    thickness,
  );
}

/** Rects of the elements a failure names (ELEMENT_OBSCURED's target, ASSERTION_FAILED's elements, MULTIPLE_MATCHES' matches). */
export function failureRects(data: Record<string, unknown> | undefined): Rect[] {
  if (data === undefined) return [];
  const out: Rect[] = [];
  const add = (e: unknown): void => {
    const r = typeof e === 'object' && e !== null ? (e as { rect?: unknown }).rect : undefined;
    if (typeof r === 'object' && r !== null) {
      const { x, y, width, height } = r as Record<string, unknown>;
      if ([x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v)) && (width as number) > 0 && (height as number) > 0) {
        out.push({ x: x as number, y: y as number, width: width as number, height: height as number });
      }
    }
  };
  add(data['element']);
  for (const key of ['elements', 'matches']) {
    const list = data[key];
    if (Array.isArray(list)) list.forEach(add);
  }
  return out;
}
