/**
 * Strict JSON check for backdoor results (requirements.md §6.6): reports the first value that would not
 * survive JSON.stringify / JSON.parse unchanged, as a path like `$.items[2].createdAt`.
 */
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
  if (Array.isArray(obj)) {
    seen.add(obj);
    for (let i = 0; i < obj.length; i++) {
      const bad = findNonJson(obj[i], `${path}[${i}]`, seen);
      if (bad !== null) return bad;
    }
    seen.delete(obj);
    return null;
  }
  const proto = Object.getPrototypeOf(obj) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    const name = (obj as { constructor?: { name?: string } }).constructor?.name ?? 'object';
    return { path, reason: `${name} instance (only plain objects and arrays)` };
  }
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    const bad = findNonJson(v, /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`, seen);
    if (bad !== null) return bad;
  }
  seen.delete(obj);
  return null;
}
