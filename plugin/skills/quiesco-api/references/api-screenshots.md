<!-- Generated from docs/api-screenshots.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Screenshots

Take a PNG of the screen, of one element, or of a whole scrolling page stitched together, and attach it to the report.
`app.device.screenshot()` returns a PNG as a `Buffer`: the screen, one element, or the whole content of a
scroll view, scrolled and stitched. With a `name` it is also saved with the test's
[artifacts](./api-artifacts.md) and attached to the report.

## Taking a screenshot {#taking-a-screenshot}

### `screenshot(target?, options?)` {#screenshot}

Without a target, the screen as shown; on the web, the browser viewport.

```ts
const png = await app.device.screenshot();

// also saved as artifacts/<run>/<test>/home.png and attached to the report
await app.device.screenshot(undefined, { name: 'home' });
```

| Option | Default | Meaning |
|---|---|---|
| `name` | | Also save the PNG in the test's artifacts directory under this name, and attach it to the report |
| `full` | `false` | With an element target: all of the element, scrolled and stitched ([an element](#an-element)) |

### An element {#an-element}

`screenshot(target)` cuts one element out of the screen: the part of it that is on the screen.
`{ full: true }` takes all of it — a scroll view with its whole content, an element partly scrolled away
together with the rest — scrolled and stitched.

```ts
// the avatar as it is on screen
await app.device.screenshot('avatar', { name: 'avatar' });

// the whole terms text, scrolled and stitched
await app.device.screenshot('terms', { full: true, name: 'terms' });
```

### A whole page {#full-page}

`screenshot({ fullPage: true })` takes the whole content of the screen's main scroll view, the largest
one. `{ fullPage: target }` takes the whole content of the scroll view matching `target`.

```ts
// the main scroll view's whole content
await app.device.screenshot({ fullPage: true }, { name: 'todos' });

// that scroll view's
await app.device.screenshot({ fullPage: 'todo-list' });
```

A full-page screenshot is the same on every platform:

1. Quiesco scrolls the scroll view to the top, programmatically (as
   [`scrollToEdge`](./api-actions.md#scrolltoedge) does in `js` mode).
2. It takes a screenshot per screenful and stitches them: everything above the scroll view (status bar,
   header) from the first one, the newly revealed strip of each next one, and what is below the scroll view
   (tab bar) from the last one. So fixed headers and footers appear once.
3. A virtualized list that renders more rows as it scrolls is followed to its end.
4. Scroll indicators are hidden meanwhile (native), and the scroll position is put back afterwards.

Content that changes while it scrolls (sticky section headers, animations) shows as it was when each
screenful was taken.

### A WebView element {#webview-element}

An element of a page inside a WebView has its own `screenshot()`: it is scrolled into view first, and the
part inside the WebView's visible area is taken. See [WebView](./api-webview.md#screenshot).

```ts
const chart = await app.webview('help').element({ css: '#chart' }).screenshot();
```

> **Note:**
>
> On the web, a screenshot fails with `DIALOG_OPEN` while a browser dialog (`alert`, `confirm`) is open: the
> page does not paint until it is answered. See [system UI](./api-system.md).

Status bar overrides for clean screenshots — the clock at 9:41, a full battery — are on
[app and device](./api-device.md#setstatusbar).
