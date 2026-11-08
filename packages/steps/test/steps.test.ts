import { CucumberExpression, ParameterTypeRegistry } from '@cucumber/cucumber-expressions';
import type { Driver } from '@quiesco/core';
import { describe, expect, it } from 'vitest';

import type { Language } from '../src';
import { GENERIC_STEPS, argsFor, parameterCount, registerQuiescoSteps } from '../src';

const LANGS: Language[] = ['zh', 'ja', 'en'];
const registry = new ParameterTypeRegistry();
const all = GENERIC_STEPS.flatMap((step) => LANGS.map((lang) => ({ step, lang, expr: new CucumberExpression(step.expressions[lang], registry) })));

function fakeApp() {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const app = new Proxy({}, { get: (_t, name: string) => record(name) }) as unknown as Driver;
  return { app, calls };
}

describe('@quiesco/steps', () => {
  it('every example matches its own expression and no other one (no ambiguous steps across languages)', () => {
    for (const { step, lang } of all) {
      const text = step.examples[lang];
      const matching = all.filter((x) => x.expr.match(text) !== null).map((x) => `${x.step.name}/${x.lang}`);
      expect(matching, text).toEqual([`${step.name}/${lang}`]);
    }
  });

  it('runs the same driver call in every language, whatever the parameter order', async () => {
    for (const step of GENERIC_STEPS) {
      const results = await Promise.all(
        LANGS.map(async (lang) => {
          const expr = new CucumberExpression(step.expressions[lang], registry);
          const params = (expr.match(step.examples[lang]) ?? []).map((a) => a.getValue(null) as string | number);
          const { app, calls } = fakeApp();
          await step.run(app, ...argsFor(step, lang, params));
          return calls;
        }),
      );
      // same method and argument kinds in all languages (texts differ by language)
      const shape = (calls: unknown[][]) => calls.map((c) => c.map((v) => (typeof v === 'object' && v !== null ? Object.keys(v).join(',') : typeof v)));
      expect(shape(results[1] as unknown[][]), step.name).toEqual(shape(results[0] as unknown[][]));
      expect(shape(results[2] as unknown[][]), step.name).toEqual(shape(results[0] as unknown[][]));
    }
    const type = GENERIC_STEPS.find((s) => s.name === 'type');
    const { app, calls } = fakeApp();
    await type?.run(app, ...argsFor(type, 'en', ['Buy milk', 'todo-title']));
    expect(calls).toEqual([['type', 'todo-title', 'Buy milk']]);
    const count = GENERIC_STEPS.find((s) => s.name === 'count');
    const c2 = fakeApp();
    await count?.run(c2.app, ...argsFor(count, 'en', [2, 'todo-item']));
    expect(c2.calls).toEqual([['expectCount', 'todo-item', 2]]);
    const tapText = GENERIC_STEPS.find((s) => s.name === 'tapText');
    const c3 = fakeApp();
    await tapText?.run(c3.app, '保存');
    expect(c3.calls).toEqual([['tap', { text: '保存' }]]);
  });

  it('registers functions with the arity cucumber-js expects, for the chosen languages and steps', async () => {
    const defined: { expression: string; length: number; fn: (...a: unknown[]) => Promise<void> }[] = [];
    const define = (expression: string, fn: (...a: unknown[]) => Promise<void>) => void defined.push({ expression, length: fn.length, fn });
    const registered = registerQuiescoSteps({ languages: ['ja'] }, define as never);
    expect(registered).toHaveLength(GENERIC_STEPS.length);
    for (const d of defined) expect(d.length, d.expression).toBe(parameterCount(d.expression));
    const { app, calls } = fakeApp();
    const tap = defined.find((d) => d.expression === '{string} をタップする');
    await tap?.fn.call({ app }, 'add-todo');
    expect(calls).toEqual([['tap', 'add-todo']]);
    defined.length = 0;
    expect(registerQuiescoSteps({ only: ['tap', 'seeText'] }, define as never)).toEqual(['点击 {string}', '{string} をタップする', 'I tap {string}', '看到文本 {string}', 'テキスト {string} が表示されている', 'I see the text {string}']);
  });
});
