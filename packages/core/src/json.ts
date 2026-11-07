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
    const proto = Object.getPrototypeOf(obj) as unknown;
    if (proto !== Object.prototype && proto !== null) {
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
