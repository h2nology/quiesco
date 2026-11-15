/**
 * Type test of the backdoor registry (src/backdoors.ts; issue #6), checked by `tsc --noEmit` in `pnpm check`.
 * Never imported: nothing of it reaches the bundle.
 */
import { quiesco } from '@quiesco/agent';
import type { Driver } from '@quiesco/core';

import type { LocationPermission } from './backdoors';

export async function backdoorTypes(app: Driver): Promise<void> {
  // the tests: declared names, their arguments and results
  await app.backdoor('loginAs', 'a@example.com');
  await app.backdoor('seedTodos', ['a', 'b']);
  const permission: LocationPermission = await app.backdoor('locationPermission');
  const opened: null = await app.backdoor('openPlayground');
  // @ts-expect-error a name nobody registered (a typo)
  await app.backdoor('logInAs', 'a@example.com');
  // @ts-expect-error wrong argument type
  await app.backdoor('seedTodos', 'a');
  // @ts-expect-error missing argument
  await app.backdoor('loginAs');
  // @ts-expect-error the result is not a number
  const wrong: number = await app.backdoor('locationPermission');

  // the app: the registered function must match the declaration (async or not)
  quiesco.backdoor('openShowcase', () => {});
  quiesco.backdoor('loginAs', async (email: string) => void email);
  // @ts-expect-error wrong parameter type
  quiesco.backdoor('loginAs', async (email: number) => void email);
  // @ts-expect-error not declared
  quiesco.backdoor('openNothing', () => {});
  void [permission, opened, wrong];
}
