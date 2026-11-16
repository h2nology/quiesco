/**
 * WebKit's clipboard for tests (findings F.3): under automation WebKit lets a page write the clipboard but
 * never read it (NotAllowedError: reading needs a user gesture and the system paste callout), and Playwright
 * has no clipboard permission for WebKit. So on WebKit the clipboard is kept by Quiesco, one per browser
 * like a device's system clipboard (it outlives relaunches): the page's `navigator.clipboard` reads and
 * writes go through a binding to it, and so do the test's setClipboard / getClipboard. Text only; a
 * `copy` event (`document.execCommand('copy')`, a user copy) stores what the page put on the event, or the
 * selected text.
 */

/** Name of the context binding the page script calls: `(op: 'get') => text`, `(op: 'set', text) => text`. */
export const CLIPBOARD_BINDING = '__quiescoClipboard';

/** Runs in every page before its scripts (context.addInitScript). Self-contained. */
export function installClipboardStore(binding: string): void {
  const call = (globalThis as unknown as Record<string, (op: 'get' | 'set', text?: string) => Promise<string>>)[binding];
  const clipboard = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  if (call === undefined || clipboard === undefined) return; // not a secure context: no clipboard API at all
  const textOf = async (items: ClipboardItems): Promise<string | null> => {
    for (const item of items) {
      if (item.types.includes('text/plain')) return (await item.getType('text/plain')).text();
    }
    return null;
  };
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(clipboard, name, { configurable: true, writable: true, value });
  };
  define('readText', () => call('get'));
  define('writeText', async (text: string) => {
    await call('set', String(text));
  });
  define('read', async () => {
    const text = await call('get');
    return [new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }) })];
  });
  define('write', async (items: ClipboardItems) => {
    const text = await textOf(items);
    if (text !== null) await call('set', text);
  });
  // After the page's own copy handlers (bubble phase on window), as a browser decides: a handler that
  // prevented the default copies what it set on the event; otherwise the selection is copied, and an
  // empty selection leaves the clipboard alone.
  addEventListener('copy', (e) => {
    const text = e.defaultPrevented ? (e.clipboardData?.getData('text/plain') ?? '') : String(getSelection() ?? '');
    if (e.defaultPrevented || text !== '') void call('set', text);
  });
}
