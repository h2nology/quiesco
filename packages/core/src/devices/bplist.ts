/**
 * Binary property lists (`bplist00`), read and written in memory: the iOS simulator's notification
 * settings (`BulletinBoard/VersionedSectionInfo.plist`) are binary plists holding NSKeyedArchiver
 * archives, which plutil cannot edit by key (bundle ids contain the key path separator).
 *
 * Values: null, booleans, integers (number, or bigint beyond 2^53), reals ({@link PlistReal}), dates,
 * data (Buffer), strings, UIDs ({@link PlistUid}, NSKeyedArchiver object references), arrays and
 * dictionaries (plain objects without a prototype).
 */

export class PlistUid {
  constructor(readonly value: number) {}
}

/** A real number, kept apart from integers so that `1.0` is written back as a real. */
export class PlistReal {
  constructor(readonly value: number) {}
}

export type PlistValue = null | boolean | number | bigint | string | Buffer | Date | PlistUid | PlistReal | PlistValue[] | PlistDict;
export interface PlistDict {
  [key: string]: PlistValue;
}

const MAGIC = 'bplist00';
/** Seconds between 1970-01-01 and the plist epoch 2001-01-01. */
const EPOCH_2001 = 978_307_200;

/** A dictionary with no prototype (keys such as `__proto__` stay plain keys). */
export function plistDict(entries: Record<string, PlistValue> = {}): PlistDict {
  return Object.assign(Object.create(null) as PlistDict, entries);
}

export function isPlistDict(v: PlistValue | undefined): v is PlistDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !Buffer.isBuffer(v) && !(v instanceof Date) && !(v instanceof PlistUid) && !(v instanceof PlistReal);
}

function readUInt(buf: Buffer, offset: number, size: number): number {
  let n = 0;
  for (let i = 0; i < size; i++) n = n * 256 + (buf[offset + i] as number);
  return n;
}

export function parseBplist(buf: Buffer): PlistValue {
  if (buf.length < 40 || buf.toString('latin1', 0, 8) !== MAGIC) throw new Error('not a binary property list');
  const t = buf.length - 32;
  const offsetSize = buf[t + 6] as number;
  const refSize = buf[t + 7] as number;
  const count = Number(buf.readBigUInt64BE(t + 8));
  const top = Number(buf.readBigUInt64BE(t + 16));
  const tableAt = Number(buf.readBigUInt64BE(t + 24));
  if (offsetSize < 1 || refSize < 1 || top >= count || tableAt + count * offsetSize > t) throw new Error('corrupt binary property list trailer');
  const offset = (i: number): number => {
    if (i >= count) throw new Error(`object reference ${i} out of range`);
    return readUInt(buf, tableAt + i * offsetSize, offsetSize);
  };
  const reading = new Set<number>();

  const object = (ref: number): PlistValue => {
    if (reading.has(ref)) throw new Error('cyclic binary property list');
    reading.add(ref);
    try {
      return parseAt(offset(ref));
    } finally {
      reading.delete(ref);
    }
  };

  /** The length in a marker's low nibble, or in the integer object that follows (0xF). */
  const length = (at: number): [number, number] => {
    const low = (buf[at] as number) & 0x0f;
    if (low !== 0x0f) return [low, at + 1];
    const marker = buf[at + 1] as number;
    if (marker >> 4 !== 0x1) throw new Error('bad length in binary property list');
    const size = 1 << (marker & 0x0f);
    return [readUInt(buf, at + 2, size), at + 2 + size];
  };

  const parseAt = (at: number): PlistValue => {
    const marker = buf[at] as number;
    const kind = marker >> 4;
    const low = marker & 0x0f;
    switch (kind) {
      case 0x0:
        if (marker === 0x00) return null;
        if (marker === 0x08) return false;
        if (marker === 0x09) return true;
        break;
      case 0x1: {
        const size = 1 << low;
        if (size === 8) {
          const v = buf.readBigInt64BE(at + 1);
          return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
        }
        if (size === 16) return buf.readBigUInt64BE(at + 9); // unsigned 128-bit: the low 64 bits
        return readUInt(buf, at + 1, size);
      }
      case 0x2:
        return new PlistReal(low === 2 ? buf.readFloatBE(at + 1) : buf.readDoubleBE(at + 1));
      case 0x3:
        if (marker === 0x33) return new Date((buf.readDoubleBE(at + 1) + EPOCH_2001) * 1000);
        break;
      case 0x4: {
        const [n, start] = length(at);
        return Buffer.from(buf.subarray(start, start + n));
      }
      case 0x5: {
        const [n, start] = length(at);
        return buf.toString('latin1', start, start + n);
      }
      case 0x6: {
        const [n, start] = length(at);
        const units = Buffer.from(buf.subarray(start, start + n * 2));
        units.swap16();
        return units.toString('utf16le');
      }
      case 0x8:
        return new PlistUid(readUInt(buf, at + 1, low + 1));
      case 0xa: {
        const [n, start] = length(at);
        const out: PlistValue[] = [];
        for (let i = 0; i < n; i++) out.push(object(readUInt(buf, start + i * refSize, refSize)));
        return out;
      }
      case 0xd: {
        const [n, start] = length(at);
        const out = plistDict();
        for (let i = 0; i < n; i++) {
          const key = object(readUInt(buf, start + i * refSize, refSize));
          if (typeof key !== 'string') throw new Error('dictionary key is not a string');
          out[key] = object(readUInt(buf, start + (n + i) * refSize, refSize));
        }
        return out;
      }
    }
    throw new Error(`unsupported binary property list object 0x${marker.toString(16)}`);
  };

  return object(top);
}

function uintBytes(n: number): number {
  return n < 0x100 ? 1 : n < 0x10000 ? 2 : n < 0x1_0000_0000 ? 4 : 8;
}

function writeUInt(n: number, size: number): Buffer {
  const b = Buffer.alloc(size);
  let v = n;
  for (let i = size - 1; i >= 0; i--) {
    b[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return b;
}

function intObject(n: number | bigint): Buffer {
  if (typeof n === 'number' && n >= 0 && n < 0x1_0000_0000) {
    const size = uintBytes(n);
    return Buffer.concat([Buffer.from([0x10 | Math.log2(size)]), writeUInt(n, size)]);
  }
  const b = Buffer.alloc(9);
  b[0] = 0x13;
  b.writeBigInt64BE(BigInt(n), 1);
  return b;
}

/** A marker with a length: in its low nibble below 15, else in an integer object after it. */
function header(kind: number, n: number): Buffer {
  return n < 0x0f ? Buffer.from([(kind << 4) | n]) : Buffer.concat([Buffer.from([(kind << 4) | 0x0f]), intObject(n)]);
}

/** An array or dictionary while writing: its children as object indexes (a dictionary: keys, then values). */
class Container {
  constructor(
    readonly kind: 0xa | 0xd,
    readonly refs: number[],
  ) {}
}

export function writeBplist(root: PlistValue): Buffer {
  // Flatten: every value becomes one object; containers refer to their children by index.
  const objects: (PlistValue | Container)[] = [];
  const add = (v: PlistValue): number => {
    const index = objects.length;
    objects.push(null);
    if (Array.isArray(v)) {
      const refs = v.map(add);
      objects[index] = new Container(0xa, refs);
    } else if (isPlistDict(v)) {
      const keys = Object.keys(v);
      const refs = [...keys.map((k) => add(k)), ...keys.map((k) => add(v[k] as PlistValue))];
      objects[index] = new Container(0xd, refs);
    } else {
      objects[index] = v;
    }
    return index;
  };
  add(root);
  const refSize = uintBytes(objects.length);

  const encode = (o: (typeof objects)[number]): Buffer => {
    if (o === null) return Buffer.from([0x00]);
    if (o === false) return Buffer.from([0x08]);
    if (o === true) return Buffer.from([0x09]);
    if (typeof o === 'number') {
      if (!Number.isInteger(o)) return encode(new PlistReal(o));
      return intObject(o);
    }
    if (typeof o === 'bigint') return intObject(o);
    if (o instanceof PlistReal) {
      const b = Buffer.alloc(9);
      b[0] = 0x23;
      b.writeDoubleBE(o.value, 1);
      return b;
    }
    if (o instanceof Date) {
      const b = Buffer.alloc(9);
      b[0] = 0x33;
      b.writeDoubleBE(o.getTime() / 1000 - EPOCH_2001, 1);
      return b;
    }
    if (o instanceof PlistUid) {
      const size = uintBytes(o.value);
      return Buffer.concat([Buffer.from([0x80 | (size - 1)]), writeUInt(o.value, size)]);
    }
    if (Buffer.isBuffer(o)) return Buffer.concat([header(0x4, o.length), o]);
    if (typeof o === 'string') {
      // eslint-disable-next-line no-control-regex
      if (/^[\x00-\x7f]*$/.test(o)) return Buffer.concat([header(0x5, o.length), Buffer.from(o, 'latin1')]);
      const units = Buffer.from(o, 'utf16le');
      units.swap16();
      return Buffer.concat([header(0x6, o.length), units]);
    }
    if (o instanceof Container) {
      const n = o.kind === 0xd ? o.refs.length / 2 : o.refs.length;
      return Buffer.concat([header(o.kind, n), ...o.refs.map((r) => writeUInt(r, refSize))]);
    }
    throw new Error('unsupported property list value');
  };

  const chunks: Buffer[] = [Buffer.from(MAGIC, 'latin1')];
  const offsets: number[] = [];
  let at = MAGIC.length;
  for (const o of objects) {
    const b = encode(o);
    offsets.push(at);
    chunks.push(b);
    at += b.length;
  }
  const offsetSize = uintBytes(at);
  const tableAt = at;
  for (const off of offsets) chunks.push(writeUInt(off, offsetSize));
  const trailer = Buffer.alloc(32);
  trailer[6] = offsetSize;
  trailer[7] = refSize;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(tableAt), 24);
  chunks.push(trailer);
  return Buffer.concat(chunks);
}
