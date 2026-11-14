/**
 * Repeated identical failures (issue #9): when the app gets into a state that every following scenario
 * inherits, each one fails the same way. After `threshold` such scenarios in a row, say so once; with
 * `bailOnRepeatedFailure` on (the default), skip the rest instead of waiting for each one's timeouts.
 */

/** Default for `bailOnRepeatedFailure`, and the streak length that prints the hint when bailing is off. */
export const DEFAULT_REPEATED_FAILURES = 3;

/**
 * What makes two failures "the same": the error's name and the first line of its message, with numbers
 * (durations, counts, ports) replaced so that "after 10012ms" and "after 10009ms" match.
 */
export function failureSignature(error: unknown): string {
  const { name, line } = describeFailure(error);
  return `${name}: ${line.replace(/\d+/g, 'N')}`;
}

/** The error's name (QuiescoError: its errorName) and the first non-empty line of its message. */
function describeFailure(error: unknown): { name: string; line: string } {
  // jest-circus keeps some failures as [error, asyncError]
  if (Array.isArray(error)) return describeFailure(error[0]);
  let name = 'Error';
  let message: string;
  if (error instanceof Error) {
    const errorName = (error as { errorName?: unknown }).errorName;
    name = errorName !== undefined ? String(errorName) : error.name;
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else if (error !== null && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    // cucumber-js result.exception { type, message }, Vitest's serialized errors { name, message }
    const o = error as { message: string; type?: unknown; name?: unknown };
    if (typeof o.type === 'string') name = o.type;
    else if (typeof o.name === 'string') name = o.name;
    message = o.message;
  } else {
    message = String(error);
  }
  return { name, line: (message.split('\n').find((l) => l.trim() !== '') ?? '').trim() };
}

export interface StreakHint {
  /** The message to print (once per streak). */
  message: string;
  /** Whether the remaining scenarios are skipped from now on. */
  bail: boolean;
}

export class RepeatedFailures {
  private signature: string | null = null;
  private firstLine = '';
  private count = 0;
  private hinted = false;
  private bailReason: string | null = null;
  private skipped = 0;

  /** `bail`: the streak length that stops the run, or false (hint only, at DEFAULT_REPEATED_FAILURES). */
  constructor(private readonly bail: number | false = DEFAULT_REPEATED_FAILURES) {
    if (bail !== false && (!Number.isInteger(bail) || bail < 1)) throw new TypeError(`bailOnRepeatedFailure must be a whole number ≥ 1 or false (got ${String(bail)})`);
  }

  /** Why the remaining scenarios are skipped, or null while they run. */
  get bailedOut(): string | null {
    return this.bailReason;
  }

  /** A scenario skipped because of the bail. */
  countSkipped(): void {
    this.skipped++;
  }

  get skippedCount(): number {
    return this.skipped;
  }

  /**
   * A finished scenario. Passing ones end the streak, failures extend it or start a new one. Returns the hint
   * when this one completes a streak (`route`: where the app is, for the message).
   */
  async record(result: { failed: boolean; error?: unknown }, route: () => Promise<string | null> = async () => null): Promise<StreakHint | null> {
    if (!result.failed) {
      this.signature = null;
      this.count = 0;
      this.hinted = false;
      return null;
    }
    const signature = failureSignature(result.error);
    if (signature === this.signature) {
      this.count++;
    } else {
      this.signature = signature;
      this.count = 1;
      this.hinted = false;
    }
    const { name, line } = describeFailure(result.error);
    this.firstLine = `${name}: ${line}`;
    const threshold = this.bail === false ? DEFAULT_REPEATED_FAILURES : this.bail;
    if (this.hinted || this.count < threshold) return null;
    this.hinted = true;
    const where = await route().catch(() => null);
    const lines = [
      `the last ${this.count} scenarios failed the same way: ${this.firstLine}`,
      `The app may not be returning to its initial state after the reset${where !== null ? ` (current route: ${where})` : ''}.`,
    ];
    if (this.bail !== false) {
      this.bailReason = `skipped: the ${this.count} scenarios before it failed the same way (bailOnRepeatedFailure: ${this.bail})`;
      lines.push(`Skipping the remaining scenarios (bailOnRepeatedFailure: ${this.bail} in quiesco.config; false runs them all).`);
    } else {
      lines.push('Set reset.expectVisible in quiesco.config to have the reset check the initial state.');
    }
    return { message: lines.join('\n'), bail: this.bail !== false };
  }
}
