test('skipped @android', () => { throw new Error('should not run'); });
test('reads global', () => { expect(globalThis.quiesco.id).toContain('esm-loaded'); });
