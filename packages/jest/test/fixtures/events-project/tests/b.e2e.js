/* global describe */
describe('broken', () => {
  throw new Error('boom while collecting');
});
