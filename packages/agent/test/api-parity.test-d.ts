import { describe, expectTypeOf, it } from 'vitest';

import type * as Real from '../src/index';
import type * as Stub from '../src/stub';

describe('production stub', () => {
  it('exports exactly the same names and API types as the real entry', () => {
    expectTypeOf<keyof typeof Stub>().toEqualTypeOf<keyof typeof Real>();
    expectTypeOf<typeof Stub.quiesco>().toEqualTypeOf<typeof Real.quiesco>();
    expectTypeOf<typeof Stub.QuiescoRoot>().toEqualTypeOf<typeof Real.QuiescoRoot>();
  });
});
