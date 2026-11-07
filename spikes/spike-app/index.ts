// Phase 0 spike: the hook module must be imported before anything that loads the React renderer.
import './spike/devtools-hook';
import './spike/scheduler-tracker';

// S6 approach B: always imported, swapped for a stub by metro.config.js in non-e2e builds.
import './spike/s6/agent-b';

import { registerRootComponent } from 'expo';

import App from './App';

// S6 approach A: env guard (EXPO_PUBLIC_* is inlined at build time).
if (process.env.EXPO_PUBLIC_QUIESCO === '1') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./spike/s6/agent-a');
}

registerRootComponent(App);
