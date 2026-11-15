/**
 * Keeps one status line at the bottom of the terminal while a child's output scrolls above it.
 *
 * The bottom region is [the child's current unfinished line, if any] + [the status line]. Before the
 * child's output is written the region is erased (cursor up, clear to the end of the screen); complete
 * lines are written; the region is drawn again. An unfinished line (cucumber's progress dots
 * `....F..`) stays visible above the bar and is completed in place by later output.
 */
import { textWidth } from './render.js';

export interface StickyOutput {
  /** Writes escape sequences and the bottom region (stdout). */
  write(text: string): void;
  /** Current terminal width. */
  columns(): number;
}

export class StickyTerminal {
  private partial = '';
  private bar = '';
  private drawnRows = 0;
  private stopped = false;

  constructor(private readonly out: StickyOutput) {}

  /** The child wrote `chunk` (to stdout or stderr: `write` is that stream). */
  output(chunk: string, write: (text: string) => void): void {
    if (this.stopped) {
      write(chunk);
      return;
    }
    this.erase();
    const text = this.partial + chunk;
    const nl = text.lastIndexOf('\n');
    if (nl === -1) {
      this.partial = text;
    } else {
      write(text.slice(0, nl + 1));
      this.partial = text.slice(nl + 1);
    }
    this.draw();
  }

  /** Show `line` as the status line (no wider than the terminal). */
  setBar(line: string): void {
    if (this.stopped || line === this.bar) return;
    this.erase();
    this.bar = line;
    this.draw();
  }

  /** Remove the region; write the unfinished line back, then `finalLine` (if any) as plain output. */
  stop(finalLine?: string): void {
    if (this.stopped) return;
    this.erase();
    this.stopped = true;
    let tail = this.partial;
    this.partial = '';
    if (finalLine !== undefined) tail += `${tail === '' ? '' : '\n'}${finalLine}\n`;
    if (tail !== '') this.out.write(tail);
  }

  private visiblePartial(): string {
    // A carriage return inside the unfinished line rewrites it from the start, as a terminal would.
    const cr = this.partial.lastIndexOf('\r');
    return cr === -1 ? this.partial : this.partial.slice(cr + 1);
  }

  private rows(text: string): number {
    const cols = Math.max(1, this.out.columns());
    return Math.max(1, Math.ceil(textWidth(text) / cols));
  }

  private draw(): void {
    const partial = this.visiblePartial();
    if (partial === '' && this.bar === '') return;
    let text = '';
    let rows = 0;
    if (partial !== '') {
      text += `${partial}\n`;
      rows += this.rows(partial);
    }
    text += this.bar;
    rows += 1;
    this.out.write(text);
    this.drawnRows = rows;
  }

  private erase(): void {
    if (this.drawnRows === 0) return;
    const up = this.drawnRows - 1;
    this.out.write(`\r${up > 0 ? `\u001b[${up}A` : ''}\u001b[0J`);
    this.drawnRows = 0;
  }
}
