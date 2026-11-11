/**
 * Minimal PNG crop for element screenshots (Phase 6.5): decode → cut a rectangle → encode, with
 * node:zlib only (no image dependency in core). Supports what simctl / screencap / Playwright produce:
 * 8-bit RGB or RGBA, not interlaced. Anything else fails with a clear message.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DecodedPng {
  width: number;
  height: number;
  /** 3 (RGB) or 4 (RGBA). */
  channels: 3 | 4;
  /** Rows of `width * channels` bytes, no filter bytes. */
  pixels: Buffer;
}

export function decodePng(png: Buffer): DecodedPng {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG image');
  let width = 0;
  let height = 0;
  let channels: 3 | 4 = 4;
  const idat: Buffer[] = [];
  for (let off = 8; off + 8 <= png.length; ) {
    const len = png.readUInt32BE(off);
    const type = png.toString('latin1', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      const interlace = data[12];
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) {
        throw new Error(`unsupported PNG (bit depth ${depth}, color type ${color}, interlace ${interlace}); expected 8-bit RGB/RGBA, not interlaced`);
      }
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (width === 0 || height === 0) throw new Error('PNG without IHDR');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('truncated PNG data');
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    unfilter(filter, src, row, prev, channels);
  }
  return { width, height, channels, pixels };
}

function unfilter(filter: number, src: Buffer, out: Buffer, prev: Buffer | null, bpp: number): void {
  for (let i = 0; i < src.length; i++) {
    const a = i >= bpp ? (out[i - bpp] as number) : 0;
    const b = prev !== null ? (prev[i] as number) : 0;
    const c = prev !== null && i >= bpp ? (prev[i - bpp] as number) : 0;
    const x = src[i] as number;
    let v: number;
    switch (filter) {
      case 0: v = x; break;
      case 1: v = x + a; break;
      case 2: v = x + b; break;
      case 3: v = x + ((a + b) >> 1); break;
      case 4: {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        break;
      }
      default:
        throw new Error(`bad PNG filter type ${filter}`);
    }
    out[i] = v & 0xff;
  }
}

export function encodePng(img: DecodedPng): Buffer {
  const stride = img.width * img.channels;
  const raw = Buffer.alloc(img.height * (stride + 1));
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    img.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = img.channels === 4 ? 6 : 2;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (CRC_TABLE === null) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Cut `rect` (pixels, clamped to the image) out of a PNG. Throws when nothing of it is on the image. */
export function cropPng(png: Buffer, rect: PixelRect): Buffer {
  const img = decodePng(png);
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) throw new Error(`the area (${rect.x}, ${rect.y}, ${rect.width}×${rect.height}) is outside the ${img.width}×${img.height} screenshot`);
  const w = x1 - x0;
  const h = y1 - y0;
  const out = Buffer.alloc(w * h * img.channels);
  const stride = img.width * img.channels;
  for (let y = 0; y < h; y++) {
    const from = (y0 + y) * stride + x0 * img.channels;
    img.pixels.copy(out, y * w * img.channels, from, from + w * img.channels);
  }
  return encodePng({ width: w, height: h, channels: img.channels, pixels: out });
}

/**
 * Frame `rects` (pixels) with `thickness`-pixel borders of `color` (RGB), e.g. the elements of a failed
 * step (Phase 6.9). Parts outside the image are clipped.
 */
export function drawRects(png: Buffer, rects: readonly PixelRect[], color: readonly [number, number, number] = [255, 0, 0], thickness = 4): Buffer {
  const img = decodePng(png);
  const put = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const o = (y * img.width + x) * img.channels;
    img.pixels[o] = color[0];
    img.pixels[o + 1] = color[1];
    img.pixels[o + 2] = color[2];
    if (img.channels === 4) img.pixels[o + 3] = 255;
  };
  for (const r of rects) {
    const x0 = Math.round(r.x);
    const y0 = Math.round(r.y);
    const x1 = Math.round(r.x + r.width) - 1;
    const y1 = Math.round(r.y + r.height) - 1;
    for (let t = 0; t < thickness; t++) {
      for (let x = x0; x <= x1; x++) {
        put(x, y0 + t);
        put(x, y1 - t);
      }
      for (let y = y0; y <= y1; y++) {
        put(x0 + t, y);
        put(x1 - t, y);
      }
    }
  }
  return encodePng(img);
}

/** Rows `[from, to)` of a PNG. */
export interface PngStrip {
  png: Buffer;
  from: number;
  to: number;
}

/**
 * Stack strips of PNGs of the same width top to bottom into one image (full-page screenshots). Strips
 * are clamped to their image; RGB and RGBA may be mixed (the result is RGBA then).
 */
export function stackPng(strips: readonly PngStrip[]): Buffer {
  const imgs = strips.map((s) => ({ img: decodePng(s.png), from: s.from, to: s.to }));
  const first = imgs[0];
  if (first === undefined) throw new Error('nothing to stack');
  const width = first.img.width;
  if (imgs.some((s) => s.img.width !== width)) throw new Error(`screenshots of different widths (${imgs.map((s) => s.img.width).join(', ')}) cannot be stacked`);
  const channels: 3 | 4 = imgs.every((s) => s.img.channels === 3) ? 3 : 4;
  const rows: Buffer[] = [];
  for (const { img, from, to } of imgs) {
    const y0 = Math.max(0, Math.floor(from));
    const y1 = Math.min(img.height, Math.ceil(to));
    for (let y = y0; y < y1; y++) {
      const row = img.pixels.subarray(y * width * img.channels, (y + 1) * width * img.channels);
      if (img.channels === channels) rows.push(row);
      else {
        const out = Buffer.alloc(width * 4);
        for (let x = 0; x < width; x++) {
          row.copy(out, x * 4, x * 3, x * 3 + 3);
          out[x * 4 + 3] = 255;
        }
        rows.push(out);
      }
    }
  }
  if (rows.length === 0) throw new Error('the strips hold no rows');
  return encodePng({ width, height: rows.length, channels, pixels: Buffer.concat(rows) });
}

/** Width × height of a PNG from its header. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG image');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
