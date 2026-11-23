<!-- Generated from docs/api-system.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# System UI

Biometrics, shaking, notifications, the keychain, permission dialogs and other system UI outside the app, and the web page's JavaScript dialogs.
Some of what a test needs is not part of the app: a Face ID prompt, a push notification, the dialog that
asks for a permission. These methods live on `app.device` and drive the device or the system's own UI.

They work on iOS simulators and Android emulators (on Android the emulator's console fakes the sensors, so
not on a real device). On the web they fail with `ACTION_NOT_SUPPORTED` (tag such tests `@native`,
[test tags](./api-tags.md)), except `system.tap`, `system.expectVisible` and `system.expectNotVisible`, which
answer the page's [JavaScript dialogs](#web-dialogs).

## Biometrics {#biometrics}

A typical Face ID / fingerprint login test:

```ts
// Face ID / Touch ID / a fingerprint is set up
await app.device.biometrics.enroll();

// the app calls LocalAuthentication.authenticateAsync()
await app.tap('login-with-face-id');

// a matching face / finger: the app's authentication succeeds
await app.device.biometrics.match();
await app.expectVisible('home-screen');
```

### `biometrics.enroll(enrolled?)` {#biometrics-enroll}

Enrolls a face or fingerprint, or removes it with `enroll(false)`. `enrolled` defaults to `true`. On
Android, Quiesco sets a screen-lock PIN (fingerprints need one) and goes through Settings' enrollment
screens; the app is brought back to the front afterwards. The enrollment is undone before the next test.

```ts
// a device without biometrics: the app should offer the password instead
await app.device.biometrics.enroll(false);
await app.tap('login');
await app.expectVisible('password-input');
```

### `biometrics.match()` {#biometrics-match}

Presents a matching face or finger to the authentication the app is showing, so it succeeds.

```ts
await app.tap('unlock');
await app.device.biometrics.match();
await app.expectVisible('vault-contents');
```

### `biometrics.fail()` {#biometrics-fail}

Presents an unknown face or finger. As on a real device, the system keeps its retry prompt up afterwards:
the app gets no result until the prompt is answered (match again, or cancel it with
[`system.tap`](#system-tap)). Several failures in a row lock the sensor for a while (on the Android
emulator from about 0.5 s up to 30 s).

```ts
await app.tap('unlock');
await app.device.biometrics.fail();

// the system prompt is still up: cancel it
await app.device.system.tap({ text: 'Cancel' });
await app.expectText('unlock-error', 'Authentication cancelled');
```

## Device {#device}

### `shake()` {#shake}

Shakes the device (iOS: the Simulator's *Device > Shake*; Android emulator: pushes on the accelerometer),
then waits for the app to be idle.

```ts
// the app opens its feedback form on a shake
await app.device.shake();
await app.expectVisible('feedback-form');
```

### `clearKeychain()` {#clearkeychain}

iOS: resets the simulator's keychain, for every app on it. Android has no keychain and fails with
`ACTION_NOT_SUPPORTED`: use [`relaunch({ clearData: true })`](./api-device.md#relaunch), which deletes the
app's data, Keystore keys included.

```ts
// a token saved by expo-secure-store in an earlier test is gone
await app.device.clearKeychain();
await app.device.relaunch();
await app.expectVisible('sign-in-screen');
```

## Notifications {#notifications}

### `sendNotification({ title, body?, data? })` {#sendnotification}

Delivers a notification. It also works while the app is in the background.

- **iOS**: a simulated remote push (`simctl push`), with `data` next to `aps` in the payload. The app's push
  library receives it while the app is in front. The system shows it only when the app may show
  notifications, which cannot be granted in advance on the simulator: let the app ask, and answer with
  [`allowPermission()`](#system-allowpermission).
- **Android**: an emulator has no push service, so the notification is posted as the app (it needs the
  `notifications` permission). Tapping it opens the app with `data` as intent extras; the push library's
  callbacks do not fire.

```ts
await app.device.sendNotification({
  title: 'New message',
  body: 'Ann: are we still on for lunch?',
  data: { chatId: '42' },
});
```

| Field | Meaning |
|---|---|
| `title` | The notification's title. Required, not empty |
| `body` | Its text |
| `data` | Custom data; every value must be a string |

### `openNotification(title, options?)` {#opennotification}

Taps the notification titled `title`, as a user opening it: on iOS its banner, or in Notification Center
once the banner is gone; on Android in the notification shade. Resolves when the app is in front and idle.

```ts
await app.device.sendToBackground();
await app.device.sendNotification({ title: 'New message', data: { chatId: '42' } });

// tap it: the app opens on the chat
await app.device.openNotification('New message');
await app.expectVisible('chat-42');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `10000` | How long to wait for the notification to be posted |

Details:

- It waits for the notification to be posted, so one the app schedules a few seconds ahead is found. On iOS
  the time the system UI runner takes to start does not count against `timeoutMs`.
- A tap counts once the app comes to the front. On iOS, when it does not, it looks again; in a stack of the
  app's notifications it taps the newest one. After a tap it may take 3 s more to tap again.
- On iOS the app's earlier notifications stay in Notification Center, across reboots and reinstalls, and
  group with the new one: the first tap expands the group, and on iOS 27 the next one reveals an "Open"
  button to tap. With a slow simulator, raise `timeoutMs`.

## System UI {#system-ui}

`app.device.system` finds and taps UI outside the app's React views: a permission dialog, the biometric
prompt, a web page's JavaScript dialog ([what it includes](#what-system-ui-includes)). Elements are found
by a **query**:

| Field | Matches |
|---|---|
| `text` | The exact text (typographic quotes and apostrophes count as plain ones), or a RegExp |
| `id` | Android: the resource-id, in full or the part after `:id/` |

Give `text`, `id` or both. Each call waits up to `timeoutMs` (10 s) for the UI to show up (or go away).
On iOS system UI slides in: an element is used once two reads 250 ms apart agree on where it is (for
`tap`, `expectVisible`, `type` and the permission dialogs).

### `system.tap(query, options?)` {#system-tap}

Taps system UI outside the app, then waits for the app to be idle.

```ts
// the app shows a native action sheet
await app.tap('share');
await app.device.system.tap({ text: 'Cancel' });

// Android: a button by its resource-id
await app.device.system.tap({ id: 'android:id/button1' });

// any text that starts with "Allow"
await app.device.system.tap({ text: /^Allow/ });
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `10000` | How long to wait for it to show up |

### `system.expectVisible(query, options?)` {#system-expectvisible}

Waits until such system UI is on screen. Fails with `ELEMENT_NOT_FOUND`, listing the texts it saw.

```ts
await app.tap('enable-location');
await app.device.system.expectVisible({ text: /location/i });
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `10000` | How long to wait |

### `system.expectNotVisible(query, options?)` {#system-expectnotvisible}

Waits until no such system UI is on screen. Fails with `ASSERTION_FAILED`, naming the text still there.

```ts
await app.device.system.tap({ text: 'OK' });
await app.device.system.expectNotVisible({ text: 'Delete all?' });
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `10000` | How long to wait |

### `system.type(query, text, options?)` {#system-type}

Taps the field matching `query` and types `text` into it with the device's input; then waits for the app
to be idle. When a label and a field have the same text, the field is used (a label "Email" next to its
input). On iOS the text goes through the keyboard, so any text works. On Android printable ASCII is sent
as key events (`input text`); other text is pasted through `@quiesco/native`'s clipboard.

```ts
// a login page in an authentication session (expo-web-browser's openAuthSessionAsync)
await app.tap('sign-in-with-sso');
await app.device.system.type({ text: 'Email' }, 'ann@example.com');
await app.device.system.type({ text: 'Password' }, 'secret');
await app.device.system.tap({ text: 'Sign in' });
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `10000` | How long to wait for the field to show up |

### `system.tapAt({ x, y })` {#system-tapat}

A system-level touch at a point of the screen (points / dp from the top-left corner), over whatever is
there. For example, tapping above iOS's share sheet closes it. On iOS it first waits (up to 2 s) until the
system UI on screen stops moving. Then it waits for the app to be idle.

```ts
await app.tap('share');

// close the share sheet by tapping above it
await app.device.system.tapAt({ x: 200, y: 100 });
```

## Permission dialogs {#permission-dialogs}

The app asks for a permission and the system shows its dialog; the test answers it as a user would.
To start a test with a permission already granted, use the `permissions` config or
[`setPermission`](./api-device.md#setpermission) instead ([per platform](./platforms.md#permissions)).

### `system.allowPermission(options?)` {#system-allowpermission}

Taps the dialog's allow button, whatever the device language. On Android it finds the button by its id,
including "while using the app"; on iOS by its position, as iOS lays the buttons out. Resolves when the
app is in front and idle.

```ts
// the app asks for a permission
await app.tap('enable-notifications');

// the system dialog's allow button
await app.device.system.allowPermission();
await app.expectText('notifications-status', 'On');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `10000` | How long to wait for the dialog |

### `system.denyPermission(options?)` {#system-denypermission}

Taps the dialog's deny button, the same way (on Android also "don't ask again"). Resolves when the app is
in front and idle.

```ts
await app.tap('enable-location');
await app.device.system.denyPermission();
await app.expectVisible('location-denied-banner');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `10000` | How long to wait for the dialog |

**Answer a permission dialog in the test that brings it up.** Alerts outlive the app: one a test leaves
open is dismissed before the next (cancel, else its first button), except a permission dialog. Either
answer to it sticks (a denied notification permission only goes away with a reinstall), so the next test
fails with `RESET_FAILED` naming it. To ask for a permission again, reset it first:

```ts
await app.device.setPermission('notifications', 'reset');
```

While a permission dialog (another activity) is in front, Android pauses the app's JS timers. Quiesco's
idle wait notices that the app went to the background and returns, so the tap that opened the dialog
completes.

## What system UI includes {#what-system-ui-includes}

Besides the system's own UI (SpringBoard on iOS, other packages on Android), `system.*` sees UI that is
not React:

- **Android**: the app's own dialog windows, e.g. the date dialog of `DateTimePickerAndroid`. A React
  Native `Modal` is such a window too.

  ```ts
  await app.tap('pick-date');
  await app.device.system.tap({ text: '25' });

  // OK, in any language
  await app.device.system.tap({ id: 'android:id/button1' });
  ```

- **iOS**: the app's UIKit views (an inline `DateTimePicker`'s days, the keyboard's keys, the share sheet),
  and the web page of an authentication session (`expo-web-browser`'s `openAuthSessionAsync`,
  SafariViewService) or Safari when they are in front: type with [`system.type`](#system-type), tap with
  [`system.tap`](#system-tap). The app's React views are in that tree as well; tapping them is a real touch
  all the same. Close the share sheet with [`system.tapAt`](#system-tapat) above it. A React Native `Modal`
  shown a second time in a session can be missing from the tree XCUITest reports; `app.*` reaches its
  views.

On the Android emulator, `openAuthSessionAsync` needs a browser with Custom Tabs (an image with Google
Play); the AOSP images have none.

On iOS, system UI belongs to SpringBoard. Quiesco builds a small XCUITest runner the first time it is
needed (once per Xcode version, cached in `~/Library/Caches/quiesco/ios-runner`, about 10 s) and starts it
on the simulator (2–4 s, once per session).

## Web: JavaScript dialogs {#web-dialogs}

On the web, `alert`, `confirm` and `prompt` stay open until the test answers them, as a user would: they
count as system UI. The dialog's message is a node with id `dialog.message`. Its buttons are `OK` (id
`dialog.accept`) and, for `confirm` / `prompt`, `Cancel` (`dialog.dismiss`). An accepted `prompt` gets its
default value.

```ts
// the page calls confirm('Delete all?')
await app.tap('clear-all');

await app.device.system.expectVisible({ text: 'Delete all?' });

// confirm() returns false; then waits for idle
await app.device.system.tap({ text: 'Cancel' });
```

While a dialog is open the page runs no script and takes no input. So:

- the action that opened it returns as soon as the dialog is up, without waiting for idle;
- any other call on the app fails at once with `DIALOG_OPEN` naming the dialog: answer it first. A
  screenshot fails too, as the page does not paint;
- a dialog still open when the test ends is dismissed before the next one, with a warning;
- `beforeunload` prompts are always accepted: leaving or reloading the page is never held up.
