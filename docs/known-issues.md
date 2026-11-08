# Known issues

## Web: "Requiring unknown module" reported as fatal on the first navigation to a lazy route

- Seen with: Expo SDK 58, Expo Router static output (`web.output: "static"`), production web export.
- What happens: on the first navigation to a route whose chunk is not loaded yet, Expo Router's async
  require first tries a synchronous `require` of the route module. Metro's guarded module loader does
  not throw on the missing module; it calls `ErrorUtils.reportFatalError(...)`. Expo then loads the
  chunk and the navigation completes normally.
- Real users hit it too: it is reported silently in production (verified: a plain Playwright UI login
  without Quiesco reaches `/todos`, and a wrapped `ErrorUtils` global handler records
  `FATAL: Requiring unknown module "818".`).
- Quiesco: app errors fail the current step (requirements.md §7), so this report would fail the first
  scenario that navigates. `DEFAULT_IGNORED_APP_ERRORS` in `@quiesco/core` ignores it (logged as a
  warning instead). Turn the defaults off with `appErrors: { ignoreDefaults: false }`; add your own
  patterns with `appErrors: { ignore: [...] }`. A genuinely missing module still fails the scenario
  through the following assertions.
