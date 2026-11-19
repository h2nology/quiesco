import { afterAll, beforeEach, describe, test } from 'vitest';

const reset = () => {};
test.beforeEach(reset);
test.afterEach(() => {});
test.beforeAll(async () => {});
test.afterAll(function cleanup() {});
beforeEach(reset);

test('logs in', () => {});

describe('list', () => {
  test.beforeEach(reset);
  afterAll(reset);
  test('shows items', () => {});
});

const it2 = test.extend({});
it2.beforeEach(reset);
it2('extended', () => {});
