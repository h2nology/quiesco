<!-- Generated from docs/api-webview.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# WebView

Find, tap, type into and check elements of a web page shown inside the app, and run scripts in it.
`app.webview()` reaches the elements of a page shown in a WebView: react-native-webview on iOS and
Android, an `<iframe>` on the web. react-native-webview has no web implementation, so an app renders an
iframe there itself, e.g. in a `MyWebView.web.tsx`.

```ts
const help = app.webview('help');

await help.element({ css: '#name' }).type('Bob');
await help.element({ text: 'Say hello' }).tap();
await help.element({ id: 'result' }).expectText('Hello, Bob');
```

- **Every call waits** for the app to be idle and for the page to settle: loaded, and no `fetch` /
  `XMLHttpRequest` of the page running (counted by a script Quiesco adds to the page). The page's timers
  are not tracked; assertions retry until their timeout anyway.
- **Only the WebView's main frame:** iframes inside the page and shadow DOM are not reached.
- **iOS and Android need `@quiesco/native`**: scripts run through the native WebView, so the app needs no
  `onMessage`. Without it, calls fail with `ACTION_NOT_SUPPORTED`.

Every method takes the `timeoutMs` and `sync` [call options](./api.md#call-options) as its last argument.

## Finding the page and its elements {#finding}

### `webview(target?)` {#webview}

The WebView matching `target`, any [matcher](./api-matchers.md) such as its testID. Without an argument, the
only WebView on screen.

```ts
const help = app.webview('help');

// the only WebView on screen
const page = app.webview();
```

### `element(query)` {#element}

An element of the page. `query` has exactly one of `css`, `xpath`, `id` or `text`, and optionally an
`index` when several elements match.

```ts
help.element({ css: '#name' });
help.element({ xpath: '//input[@name="name"]' });
help.element({ id: 'result' });

// the element's text with whitespace collapsed, exactly
help.element({ text: 'Say hello' });
help.element({ text: /^Loading/ });

// the second of several matches
help.element({ css: '.faq-item', index: 1 });
```

| Field | Meaning |
|---|---|
| `css` | A CSS selector |
| `xpath` | An XPath expression |
| `id` | The element's `id` attribute |
| `text` | The element's text with whitespace collapsed, exactly, or a RegExp. The innermost matching element |
| `index` | Which match, from `0` |

## Acting on elements {#actions}

### `tap(options?)` {#tap}

A real tap, after scrolling the element into view: on iOS and Android a touch at the element's position on
the screen, on the web Playwright input.

```ts
await help.element({ text: 'Contact us' }).tap();
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

It fails at once with `MULTIPLE_MATCHES` when several elements match, and with `ELEMENT_NOT_FOUND` when no
visible, enabled match appears within the timeout.

### `type(text, options?)` {#type}

Taps the field, so it gets the focus as from a user, then inserts `text` at the caret
(`execCommand('insertText')`, which fires `input` events like typing). There is no software keyboard input.

```ts
await help.element({ css: '#name' }).type('Alice');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `replaceText(text, options?)` {#replacetext}

Taps the field, then replaces its whole value with `text`.

```ts
await help.element({ xpath: '//input[@name="name"]' }).replaceText('Bob');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `scrollIntoView(options?)` {#scrollintoview}

Scrolls the page until the element is in view.

```ts
await help.element({ css: '#footer' }).scrollIntoView();
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `screenshot(options?)` {#screenshot}

A PNG of the element, scrolled into view first: the part inside the WebView's visible area. More on
[screenshots](./api-screenshots.md).

```ts
const png = await help.element({ css: '#chart' }).screenshot();
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

## Assertions {#assertions}

Like the app's own [assertions](./api-assertions.md), these retry until they hold or the call's timeout
runs out.

### `expectText(text, options?)` {#expecttext}

The single match's text equals `text` (whitespace collapsed), or matches a RegExp. For an input field, its
value.

```ts
await help.element({ id: 'result' }).expectText('Hello, Bob');
await help.element({ css: '#name' }).expectText(/^Bo/);
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectExists(options?)` {#expectexists}

At least one element matches, visible or not.

```ts
await help.element({ css: 'form#contact' }).expectExists();
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectNotExists(options?)` {#expectnotexists}

No element matches.

```ts
await help.element({ css: '.error' }).expectNotExists();
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectVisible(options?)` {#expectvisible}

A match is visible: in the page's viewport (not scrolled away) and not hidden by CSS.

```ts
await help.element({ text: 'Thanks for your message' }).expectVisible();
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectNotVisible(options?)` {#expectnotvisible}

No match is visible: each one is scrolled away, hidden by CSS, or missing.

```ts
await help.element({ text: /^Loading/ }).expectNotVisible();
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

## The page {#the-page}

### `runScript(body, args?, options?)` {#runscript}

Runs a function body in the page and returns its value, as JSON. `args` are passed as `arguments`; a
returned promise is awaited.

```ts
const title = await help.runScript<string>('return document.title');

const count = await help.runScript<number>(
  'return document.querySelectorAll(arguments[0]).length',
  ['.faq-item'],
);

// a promise is awaited
const status = await help.runScript<number>('return fetch("/api/ping").then((r) => r.status)');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

An exception in the page fails the call with `APP_ERROR`. `runScript` uses `new Function`, which a page's
Content-Security-Policy may forbid.

### `url(options?)` {#url}

The page's URL, `location.href`.

```ts
await help.element({ text: 'Pricing' }).tap();
expect(await help.url()).toMatch(/\/pricing$/);
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `title(options?)` {#title}

The page's title, `document.title`.

```ts
expect(await help.title()).toBe('Help center');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the page to settle and for the element |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
