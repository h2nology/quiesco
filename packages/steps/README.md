# @quiesco/steps

Optional generic cucumber steps for Quiesco, in Chinese, Japanese and English.

> **Operation scripts, not requirements.** These steps describe taps and texts ("tap `login-button`"),
> not what the user wants to achieve. Use them while prototyping or exploring an app. A real project
> writes its own steps in the language of the business ("When the user logs in as …") on top of
> `this.app` — or a driver of its own (see the Driver pattern in the Quiesco docs) — so the features
> keep describing requirements when the UI changes.

## Use

```ts
// features/support/steps.ts
import { registerQuiescoSteps } from '@quiesco/steps';

registerQuiescoSteps(); // all languages; or { languages: ['ja'] }, { only: ['tap', 'seeText'] }
```

`@quiesco/cucumber/register` must be imported too (it provides `this.app`). The steps are registered
with cucumber's keyword-agnostic `defineStep`, so they work after any keyword (`当` / `もし` / `When` …)
and in feature files of any `# language:`.

A quoted target is a **testID**; the "text" variants match the displayed text instead. Every step waits
for the app to become idle like any other Quiesco call — no sleeps.

## Steps

| Step | 中文 | 日本語 | English |
|---|---|---|---|
| `tap` | `点击 "add-todo"` | `"add-todo" をタップする` | `I tap "add-todo"` |
| `tapText` | `点击文本 "保存"` | `テキスト "保存" をタップする` | `I tap the text "Save"` |
| `longPress` | `长按 "todo-item"` | `"todo-item" を長押しする` | `I long press "todo-item"` |
| `type` | `在 "todo-title" 中输入 "买牛奶"` | `"todo-title" に "牛乳を買う" と入力する` | `I type "Buy milk" into "todo-title"` |
| `clear` | `清空 "todo-title" 的内容` | `"todo-title" の入力をクリアする` | `I clear "todo-title"` |
| `scrollTo` | `在 "todo-list" 中滚动到 "todo-item-30"` | `"todo-list" を "todo-item-30" までスクロールする` | `I scroll "todo-list" to "todo-item-30"` |
| `dismissKeyboard` | `收起键盘` | `キーボードを閉じる` | `I dismiss the keyboard` |
| `pressBack` | `按返回键` | `戻るボタンを押す` | `I press back` |
| `openUrl` | `打开链接 "myapp://todos"` | `リンク "myapp://todos" を開く` | `I open the link "myapp://todos"` |
| `seeText` | `看到文本 "买牛奶"` | `テキスト "牛乳を買う" が表示されている` | `I see the text "Buy milk"` |
| `notSeeText` | `看不到文本 "买牛奶"` | `テキスト "牛乳を買う" が表示されていない` | `I do not see the text "Buy milk"` |
| `visible` | `元素 "todo-list" 可见` | `要素 "todo-list" が表示されている` | `the element "todo-list" is visible` |
| `notVisible` | `元素 "todo-title-error" 不可见` | `要素 "todo-title-error" が表示されていない` | `the element "todo-title-error" is not visible` |
| `hasText` | `元素 "greeting" 的文本是 "a@example.com"` | `要素 "greeting" のテキストが "a@example.com" である` | `the element "greeting" has the text "a@example.com"` |
| `count` | `元素 "todo-item" 共有 2 个` | `要素 "todo-item" が 2 個ある` | `there are 2 elements "todo-item"` |

`pressBack` is not available on iOS (no back button); Quiesco reports `ACTION_NOT_SUPPORTED` there.
