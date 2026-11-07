// Phase 0 spike: the hook module must be imported before anything that loads the React renderer.
import './spike/devtools-hook';
import './spike/scheduler-tracker';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
