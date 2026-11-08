// Side-effect module: must be evaluated before React Native's renderer and before the app's code
// (docs/spikes/01 §1, 02 §2). `@quiesco/agent` imports it first; keep it that way.
import './early';
import { getRuntime } from './singleton';

getRuntime();
