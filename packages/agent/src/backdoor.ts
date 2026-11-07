/** Backdoor registry (requirements.md §6.6). */
import type { JsonValue } from '@quiesco/protocol';

import type { Backdoor } from './api-types';
import { QuiescoError } from './errors';
import { findNonJson } from './json-check';

export class BackdoorRegistry {
  private readonly fns = new Map<string, Backdoor>();

  register(name: string, fn: Backdoor): () => void {
    if (typeof name !== 'string' || name === '') throw new TypeError('quiesco.backdoor(name, fn): name must be a non-empty string');
    if (typeof fn !== 'function') throw new TypeError(`quiesco.backdoor('${name}', fn): fn must be a function`);
    this.fns.set(name, fn);
    return () => {
      if (this.fns.get(name) === fn) this.fns.delete(name);
    };
  }

  names(): string[] {
    return [...this.fns.keys()].sort();
  }

  /** Run a backdoor. The caller waits for idle afterwards. */
  async call(name: string, args: readonly JsonValue[]): Promise<JsonValue> {
    const fn = this.fns.get(name);
    if (fn === undefined) {
      const registered = this.names();
      throw new QuiescoError(
        'BACKDOOR_NOT_REGISTERED',
        `No backdoor named "${name}". Registered: ${registered.length > 0 ? registered.join(', ') : '(none)'}`,
        { name, registered },
      );
    }
    const badArg = findNonJson(args, '$args');
    if (badArg !== null) {
      throw new QuiescoError('NOT_SERIALIZABLE', `Backdoor "${name}" argument at ${badArg.path} is not JSON (${badArg.reason})`, { where: 'args', path: badArg.path });
    }
    let value: unknown;
    try {
      value = await (fn as (...a: unknown[]) => unknown)(...args);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const data = err.stack === undefined ? { name, message: err.message } : { name, message: err.message, stack: err.stack };
      throw new QuiescoError('BACKDOOR_FAILED', `Backdoor "${name}" threw: ${err.message}`, data);
    }
    if (value === undefined) return null;
    const bad = findNonJson(value, '$result');
    if (bad !== null) {
      throw new QuiescoError('NOT_SERIALIZABLE', `Backdoor "${name}" returned a value that is not JSON at ${bad.path} (${bad.reason})`, { where: 'result', path: bad.path });
    }
    return value as JsonValue;
  }
}
