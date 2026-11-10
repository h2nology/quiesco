/**
 * Finding system UI outside the app (Phase 6.7 batch C): `app.device.system.*` match what a provider's
 * `systemNodes()` returns. Platform independent; the providers only list and tap nodes.
 */
import type { SystemNode } from './devices/provider.js';

/** Text (exact, or a RegExp) and / or id (the full id, or the part after `:id/`). */
export interface SystemQuery {
  text?: string | RegExp;
  id?: string;
}

export interface SystemWaitOptions {
  /** How long to wait for the system UI to show up (or go away). Default 10 s. */
  timeoutMs?: number;
}

export const SYSTEM_WAIT_MS = 10_000;

/** Typographic apostrophes and quotes as typed on a keyboard ("Don’t allow" → "Don't allow"). */
function plain(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
}

export function checkSystemQuery(action: string, q: SystemQuery): void {
  if (typeof q !== 'object' || q === null) throw new TypeError(`${action}(query) needs { text } or { id }`);
  const textOk = q.text === undefined || q.text instanceof RegExp || (typeof q.text === 'string' && q.text !== '');
  const idOk = q.id === undefined || (typeof q.id === 'string' && q.id !== '');
  if (!textOk || !idOk || (q.text === undefined && q.id === undefined)) {
    throw new TypeError(`${action}(query) needs a non-empty text (string or RegExp) and / or id`);
  }
}

export function matchesSystemQuery(n: SystemNode, q: SystemQuery): boolean {
  if (q.id !== undefined && n.id !== q.id && !n.id.endsWith(`:id/${q.id}`)) return false;
  if (q.text instanceof RegExp) {
    q.text.lastIndex = 0;
    if (!q.text.test(n.text)) return false;
  } else if (q.text !== undefined && plain(n.text) !== plain(q.text)) return false;
  return true;
}

export function describeSystemQuery(q: SystemQuery): string {
  const parts: string[] = [];
  if (q.text !== undefined) parts.push(`text: ${q.text instanceof RegExp ? String(q.text) : JSON.stringify(q.text)}`);
  if (q.id !== undefined) parts.push(`id: ${JSON.stringify(q.id)}`);
  return `{ ${parts.join(', ')} }`;
}

/** The texts on screen, for error messages. */
export function seenTexts(nodes: readonly SystemNode[], max = 12): string[] {
  return [...new Set(nodes.map((n) => n.text).filter((t) => t !== ''))].slice(0, max);
}
