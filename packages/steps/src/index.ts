/**
 * @quiesco/steps — optional generic steps (requirements.md §6.11).
 *
 *   // features/support/steps.ts
 *   import { registerQuiescoSteps } from '@quiesco/steps';
 *   registerQuiescoSteps({ languages: ['zh'] });
 *
 * Only for prototyping and exploration: these steps script taps and texts instead of stating what the
 * user wants. Real projects write their own business-language steps (see docs/driver-pattern.md).
 */
import { defineStep } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

import type { GenericStep, Language } from './steps.js';
import { GENERIC_STEPS, argsFor } from './steps.js';

export { GENERIC_STEPS, argsFor } from './steps.js';
export type { GenericStep, Language } from './steps.js';

export interface RegisterStepsOptions {
  /** Step languages to register. Default: all (zh, ja, en). */
  languages?: readonly Language[];
  /** Only these steps (by `name`). Default: all. */
  only?: readonly string[];
}

type Define = (expression: string, fn: (this: QuiescoWorld, ...params: (string | number)[]) => Promise<void>) => void;

/** Number of `{…}` parameters in a cucumber expression. */
export function parameterCount(expression: string): number {
  return (expression.match(/\{[^}]*\}/g) ?? []).length;
}

type Body = (world: QuiescoWorld, params: (string | number)[]) => Promise<void>;

/**
 * cucumber-js checks a step function's arity against the expression's parameters, so the wrapper must
 * declare exactly that many (a rest parameter has length 0).
 */
function withArity(count: number, body: Body): (this: QuiescoWorld, ...params: (string | number)[]) => Promise<void> {
  switch (count) {
    case 0:
      return async function (this: QuiescoWorld) {
        await body(this, []);
      };
    case 1:
      return async function (this: QuiescoWorld, a: string | number) {
        await body(this, [a]);
      };
    case 2:
      return async function (this: QuiescoWorld, a: string | number, b: string | number) {
        await body(this, [a, b]);
      };
    default:
      throw new Error(`generic steps take at most 2 parameters (got ${count})`);
  }
}

/** Register the generic steps with cucumber-js. Returns the expressions it registered. */
export function registerQuiescoSteps(options: RegisterStepsOptions = {}, define: Define = defineStep as unknown as Define): string[] {
  const languages = options.languages ?? (['zh', 'ja', 'en'] as const);
  const steps: readonly GenericStep[] = options.only === undefined ? GENERIC_STEPS : GENERIC_STEPS.filter((st) => options.only?.includes(st.name));
  const registered: string[] = [];
  for (const step of steps) {
    for (const language of languages) {
      const expression = step.expressions[language];
      define(expression, withArity(parameterCount(expression), async (world, params) => {
        await step.run(world.app, ...argsFor(step, language, params));
      }));
      registered.push(expression);
    }
  }
  return registered;
}
