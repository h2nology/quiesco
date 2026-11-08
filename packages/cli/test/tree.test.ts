import { describe, expect, it } from 'vitest';

import { formatTree } from '../src/commands/tree';

describe('formatTree', () => {
  it('prints one indented line per node with testID, text and role', () => {
    const lines = formatTree({
      type: 'View',
      testID: 'login-screen',
      children: [
        { type: 'Text', text: 'Email', children: [] },
        { type: 'TextInput', testID: 'email', children: [] },
        { type: 'View', testID: 'login-button', role: 'button', children: [{ type: 'Text', text: 'x'.repeat(80), children: [] }] },
      ],
    });
    expect(lines).toEqual(['View #login-screen', '  Text "Email"', '  TextInput #email', '  View #login-button [button]', `    Text "${'x'.repeat(59)}…"`]);
  });

  it('explains an empty tree', () => {
    expect(formatTree(null)[0]).toMatch(/QuiescoRoot/);
  });
});
