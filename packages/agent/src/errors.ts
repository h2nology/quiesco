import { ErrorCode } from '@quiesco/protocol';
import type { ErrorDataMap, ErrorName, QuiescoErrorObject } from '@quiesco/protocol';

/** Error thrown inside the agent; serialized to a JSON-RPC error object by the connection layer. */
export class QuiescoError<N extends ErrorName = ErrorName> extends Error {
  readonly errorName: N;
  readonly data: ErrorDataMap[N];

  constructor(name: N, message: string, data: ErrorDataMap[N]) {
    super(message);
    this.name = 'QuiescoError';
    this.errorName = name;
    this.data = data;
  }

  get code(): (typeof ErrorCode)[N] {
    return ErrorCode[this.errorName];
  }

  toJSON(): QuiescoErrorObject<N> {
    return { code: this.code, message: this.message, data: { name: this.errorName, ...this.data } };
  }
}
