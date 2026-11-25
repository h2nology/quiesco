import { types } from 'node:util';

/*
 * Values a test passes in may come from another realm: Jest runs each test file in its own `vm` context, so an
 * object literal, RegExp or Date written there has that context's prototype and fails `instanceof` / prototype
 * identity checks made here (issue #115). These checks hold across realms.
 */

/** A RegExp, from any realm. */
export const isRegExp = (v: unknown): v is RegExp => types.isRegExp(v);

/** A Date, from any realm. */
export const isDate = (v: unknown): v is Date => types.isDate(v);

/** An object literal (or `Object.create(null)`), from any realm: its prototype is null or has no prototype itself. */
export function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === null || Object.getPrototypeOf(proto) === null;
}

/** Strict JSON check (same rules as the agent's): first value that would not survive a JSON round trip. */
export function findNonJson(value: unknown, path = '$', seen: Set<object> = new Set()): { path: string; reason: string } | null {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return null;
    case 'number':
      return Number.isFinite(value) ? null : { path, reason: String(value) };
    case 'undefined':
      return { path, reason: 'undefined' };
    case 'function':
    case 'symbol':
    case 'bigint':
      return { path, reason: typeof value };
  }
  if (value === null) return null;
  const obj = value as object;
  if (seen.has(obj)) return { path, reason: 'circular reference' };
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const bad = findNonJson(obj[i], `${path}[${i}]`, seen);
        if (bad !== null) return bad;
      }
      return null;
    }
    if (!isPlainObject(obj)) {
      return { path, reason: `${(obj as { constructor?: { name?: string } }).constructor?.name ?? 'object'} instance (only plain objects and arrays)` };
    }
    for (const [k, v] of Object.entries(obj)) {
      const bad = findNonJson(v, /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`, seen);
      if (bad !== null) return bad;
    }
    return null;
  } finally {
    seen.delete(obj);
  }
}
