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
  // `app.device.x()` and `app.device.system.x()` are recorded as 'device.x' / 'device.system.x'.
  const level = (prefix: string): object =>
    new Proxy({}, { get: (_t, name: string) => (name === 'device' || name === 'system' ? level(`${prefix}${name}.`) : record(`${prefix}${name}`)) });
  const app = level('') as unknown as Driver;
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

  it('maps direction, edge, orientation, appearance and permission words in every language', async () => {
    const run = async (name: string, lang: Language, text: string) => {
      const step = GENERIC_STEPS.find((st) => st.name === name);
      if (step === undefined) throw new Error(name);
      const expr = new CucumberExpression(step.expressions[lang], registry);
      const params = (expr.match(text) ?? []).map((a) => a.getValue(null) as string | number);
      const { app, calls } = fakeApp();
      await step.run(app, ...argsFor(step, lang, params));
      return calls;
    };
    expect(await run('scroll', 'zh', '在 "list" 中向下滚动')).toEqual([['scroll', 'list', 'down']]);
    expect(await run('scroll', 'en', 'I scroll "list" up')).toEqual([['scroll', 'list', 'up']]);
    expect(await run('swipe', 'en', 'I swipe left on "row"')).toEqual([['swipe', 'row', 'left']]);
    expect(await run('swipe', 'ja', '"row" を右にスワイプする')).toEqual([['swipe', 'row', 'right']]);
    expect(await run('scrollToEdge', 'ja', '"list" を一番下までスクロールする')).toEqual([['scrollToEdge', 'list', 'bottom']]);
    expect(await run('orientation', 'zh', '把设备转到竖屏')).toEqual([['device.setOrientation', 'portrait']]);
    expect(await run('appearance', 'ja', '外観をダークモードにする')).toEqual([['device.setAppearance', 'dark']]);
    expect(await run('grantPermission', 'zh', '授予 App 相机权限')).toEqual([['device.setPermission', 'camera', 'grant']]);
    expect(await run('revokePermission', 'ja', 'アプリの通知の権限を取り消す')).toEqual([['device.setPermission', 'notifications', 'revoke']]);
    expect(await run('location', 'en', 'I set the device location to 35.68, 139.76')).toEqual([['device.setLocation', 35.68, 139.76]]);
    expect(await run('switchOn', 'zh', '打开开关 "notify"')).toEqual([['setValue', 'notify', true]]);
    expect(await run('select', 'en', 'I select "High" in "priority"')).toEqual([['setValue', 'priority', 'High']]);
    expect(await run('allowDialog', 'en', 'I allow in the system dialog')).toEqual([['device.system.allowPermission']]);
    expect(await run('screenshot', 'zh', '截图并保存为 "列表"')).toEqual([['device.screenshot', undefined, { name: '列表' }]]);
    await expect(run('scroll', 'zh', '在 "list" 中向斜滚动')).rejects.toThrow(/Unknown direction "斜": use one of/);
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

describe('README', () => {
  it('lists every step with its examples (regenerate the table when steps change)', async () => {
    const { readFileSync } = await import('node:fs');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const rows = GENERIC_STEPS.map((st) => `| \`${st.name}\` | \`${st.examples.zh}\` | \`${st.examples.ja}\` | \`${st.examples.en}\` |`);
    const table = ['| Step | 中文 | 日本語 | English |', '|---|---|---|---|', ...rows].join('\n');
    expect(readme).toContain(table);
  });
});
