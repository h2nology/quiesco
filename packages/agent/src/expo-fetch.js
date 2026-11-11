// `expo/fetch` as the app sees it in e2e builds (Phase 6.10). withQuiesco() (metro.cjs) resolves the
// app's and libraries' `expo/fetch` imports here; this module's own import goes to the real one. The
// real module's exports are non-configurable getters, so they cannot be patched at runtime.
//
// The exported `fetch` is tracked like the global one (busy until the response and its body are read)
// and honors the simulated offline mode. Everything else is re-exported unchanged.
import { fetch as expoFetch } from 'expo/fetch';

import { getRuntime } from './singleton';

export * from 'expo/fetch';

export const fetch = getRuntime().wrapFetch(expoFetch);
