import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '../src/index';

describe('package skeleton', () => {
  it('exports the protocol version', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});
