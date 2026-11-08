/**
 * Earliest agent code (docs/spikes/01 §1, 02 §2): installs the React DevTools hook and the scheduler
 * patch. React Native 0.88 loads its renderer from `setup-env`, which Metro runs before the app entry,
 * so `withQuiesco()` (metro.cjs) puts this module first in `getModulesRunBeforeMainModule`.
 * `install.ts` imports it too, which keeps it in the bundle (and covers setups without that hook).
 * It must not import react-native or react.
 */
import { installEarly } from './fiber-adapter';

installEarly();
