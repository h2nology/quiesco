/**
 * A tiny terminal emulator for tests: enough of a VT100 to check what the screen shows after the
 * progress bar's writes — printable text with line wrap, \r, \n, CSI n A (cursor up), CSI 0 J (clear to
 * the end of the screen); other CSI sequences (colors) are ignored. One column per character.
 */
export class VirtualTerminal {
  private lines: string[][] = [[]];
  private row = 0;
  private col = 0;

  readonly columns: number;

  constructor(columns: number) {
    this.columns = columns;
  }

  write(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i] as string;
      if (ch === '\u001b' && text[i + 1] === '[') {
        // eslint-disable-next-line no-control-regex -- a CSI sequence starts with ESC
        const m = /^\u001b\[([0-9;?]*)([ -/]*)([@-~])/.exec(text.slice(i));
        if (m === null) continue;
        i += m[0].length - 1;
        const n = m[1] === '' ? 1 : Number(m[1]);
        if (m[3] === 'A') this.row = Math.max(0, this.row - n);
        else if (m[3] === 'J' && (m[1] === '' || m[1] === '0')) {
          this.lines[this.row] = (this.lines[this.row] ?? []).slice(0, this.col);
          this.lines.length = this.row + 1;
        }
        continue;
      }
      if (ch === '\r') this.col = 0;
      else if (ch === '\n') {
        this.row++;
        this.col = 0;
        this.lines[this.row] ??= [];
      } else {
        if (this.col >= this.columns) {
          this.row++;
          this.col = 0;
          this.lines[this.row] ??= [];
        }
        const line = (this.lines[this.row] ??= []);
        line[this.col] = ch;
        this.col++;
      }
    }
  }

  /** The screen, one string per line, trailing empty lines dropped. */
  screen(): string[] {
    const out = this.lines.map((l) => Array.from(l, (c) => c ?? ' ').join(''));
    while (out.length > 0 && out.at(-1) === '') out.pop();
    return out;
  }
}
