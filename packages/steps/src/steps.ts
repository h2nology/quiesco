/**
 * The generic steps (requirements.md §6.11), in Chinese, Japanese and English.
 *
 * These are operation scripts, not requirements: they describe taps and texts, not what the user wants
 * to achieve. Use them while prototyping or exploring; a real project writes business-language steps
 * ("When the user logs in as …") on top of `this.app` or its own driver.
 *
 * A quoted target is a testID (`点击 "add-todo"`); the "…文本 / テキスト / the text …" variants match
 * the displayed text instead.
 */
import type { Driver } from '@quiesco/core';

export type Language = 'zh' | 'ja' | 'en';

export interface GenericStep {
  /** Stable name, e.g. for docs. */
  name: string;
  /** Cucumber expression per language. Parameters are passed to `run` in the order they appear. */
  expressions: Record<Language, string>;
  /** Example step text per language (docs and tests). */
  examples: Record<Language, string>;
  /** Maps the language's parameters to `run` arguments when their order differs from `zh`. */
  order?: Partial<Record<Language, number[]>>;
  run(app: Driver, ...args: (string | number)[]): Promise<unknown>;
}

const s = (v: string | number | undefined): string => String(v);

export const GENERIC_STEPS: readonly GenericStep[] = [
  {
    name: 'tap',
    expressions: { zh: '点击 {string}', ja: '{string} をタップする', en: 'I tap {string}' },
    examples: { zh: '点击 "add-todo"', ja: '"add-todo" をタップする', en: 'I tap "add-todo"' },
    run: (app, id) => app.tap(s(id)),
  },
  {
    name: 'tapText',
    expressions: { zh: '点击文本 {string}', ja: 'テキスト {string} をタップする', en: 'I tap the text {string}' },
    examples: { zh: '点击文本 "保存"', ja: 'テキスト "保存" をタップする', en: 'I tap the text "Save"' },
    run: (app, text) => app.tap({ text: s(text) }),
  },
  {
    name: 'longPress',
    expressions: { zh: '长按 {string}', ja: '{string} を長押しする', en: 'I long press {string}' },
    examples: { zh: '长按 "todo-item"', ja: '"todo-item" を長押しする', en: 'I long press "todo-item"' },
    run: (app, id) => app.longPress(s(id)),
  },
  {
    name: 'type',
    expressions: { zh: '在 {string} 中输入 {string}', ja: '{string} に {string} と入力する', en: 'I type {string} into {string}' },
    examples: { zh: '在 "todo-title" 中输入 "买牛奶"', ja: '"todo-title" に "牛乳を買う" と入力する', en: 'I type "Buy milk" into "todo-title"' },
    // en names the text first: run(target, text)
    order: { en: [1, 0] },
    run: (app, id, text) => app.type(s(id), s(text)),
  },
  {
    name: 'clear',
    expressions: { zh: '清空 {string} 的内容', ja: '{string} の入力をクリアする', en: 'I clear {string}' },
    examples: { zh: '清空 "todo-title" 的内容', ja: '"todo-title" の入力をクリアする', en: 'I clear "todo-title"' },
    run: (app, id) => app.clear(s(id)),
  },
  {
    name: 'scrollTo',
    expressions: { zh: '在 {string} 中滚动到 {string}', ja: '{string} を {string} までスクロールする', en: 'I scroll {string} to {string}' },
    examples: { zh: '在 "todo-list" 中滚动到 "todo-item-30"', ja: '"todo-list" を "todo-item-30" までスクロールする', en: 'I scroll "todo-list" to "todo-item-30"' },
    run: (app, container, target) => app.scrollTo(s(container), s(target)),
  },
  {
    name: 'dismissKeyboard',
    expressions: { zh: '收起键盘', ja: 'キーボードを閉じる', en: 'I dismiss the keyboard' },
    examples: { zh: '收起键盘', ja: 'キーボードを閉じる', en: 'I dismiss the keyboard' },
    run: (app) => app.dismissKeyboard(),
  },
  {
    name: 'pressBack',
    expressions: { zh: '按返回键', ja: '戻るボタンを押す', en: 'I press back' },
    examples: { zh: '按返回键', ja: '戻るボタンを押す', en: 'I press back' },
    run: (app) => app.pressBack(),
  },
  {
    name: 'openUrl',
    expressions: { zh: '打开链接 {string}', ja: 'リンク {string} を開く', en: 'I open the link {string}' },
    examples: { zh: '打开链接 "myapp://todos"', ja: 'リンク "myapp://todos" を開く', en: 'I open the link "myapp://todos"' },
    run: (app, url) => app.openUrl(s(url)),
  },
  {
    name: 'seeText',
    expressions: { zh: '看到文本 {string}', ja: 'テキスト {string} が表示されている', en: 'I see the text {string}' },
    examples: { zh: '看到文本 "买牛奶"', ja: 'テキスト "牛乳を買う" が表示されている', en: 'I see the text "Buy milk"' },
    run: (app, text) => app.expectVisible({ text: s(text) }),
  },
  {
    name: 'notSeeText',
    expressions: { zh: '看不到文本 {string}', ja: 'テキスト {string} が表示されていない', en: 'I do not see the text {string}' },
    examples: { zh: '看不到文本 "买牛奶"', ja: 'テキスト "牛乳を買う" が表示されていない', en: 'I do not see the text "Buy milk"' },
    run: (app, text) => app.expectNotVisible({ text: s(text) }),
  },
  {
    name: 'visible',
    expressions: { zh: '元素 {string} 可见', ja: '要素 {string} が表示されている', en: 'the element {string} is visible' },
    examples: { zh: '元素 "todo-list" 可见', ja: '要素 "todo-list" が表示されている', en: 'the element "todo-list" is visible' },
    run: (app, id) => app.expectVisible(s(id)),
  },
  {
    name: 'notVisible',
    expressions: { zh: '元素 {string} 不可见', ja: '要素 {string} が表示されていない', en: 'the element {string} is not visible' },
    examples: { zh: '元素 "todo-title-error" 不可见', ja: '要素 "todo-title-error" が表示されていない', en: 'the element "todo-title-error" is not visible' },
    run: (app, id) => app.expectNotVisible(s(id)),
  },
  {
    name: 'hasText',
    expressions: { zh: '元素 {string} 的文本是 {string}', ja: '要素 {string} のテキストが {string} である', en: 'the element {string} has the text {string}' },
    examples: { zh: '元素 "greeting" 的文本是 "a@example.com"', ja: '要素 "greeting" のテキストが "a@example.com" である', en: 'the element "greeting" has the text "a@example.com"' },
    run: (app, id, text) => app.expectText(s(id), s(text)),
  },
  {
    name: 'count',
    expressions: { zh: '元素 {string} 共有 {int} 个', ja: '要素 {string} が {int} 個ある', en: 'there are {int} elements {string}' },
    examples: { zh: '元素 "todo-item" 共有 2 个', ja: '要素 "todo-item" が 2 個ある', en: 'there are 2 elements "todo-item"' },
    // en names the count first: run(target, count)
    order: { en: [1, 0] },
    run: (app, id, count) => app.expectCount(s(id), Number(count)),
  },
];

/** Arguments as `run` expects them, from the parameters in the order the language's expression has them. */
export function argsFor(step: GenericStep, language: Language, params: readonly (string | number)[]): (string | number)[] {
  const order = step.order?.[language];
  return order === undefined ? [...params] : order.map((i) => params[i] as string | number);
}
