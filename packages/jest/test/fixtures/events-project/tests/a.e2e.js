/* global describe, test, expect */
describe('outer', () => {
  describe('inner', () => {
    test('passes', () => {
      expect(1).toBe(1);
    });
  });
  test('fails', () => {
    expect(1).toBe(2);
  });
  test.skip('skipped', () => {});
  test.todo('todo');
  test.each([1, 2])('each %i', (n) => {
    expect(n).toBeGreaterThan(0);
  });
});
