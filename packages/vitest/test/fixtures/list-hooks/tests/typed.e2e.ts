import { test } from 'vitest';

interface Ctx {
  user: string;
}
const reset = async (_c?: Ctx): Promise<void> => {};

test.beforeEach(reset);
test('typed test', () => {});
