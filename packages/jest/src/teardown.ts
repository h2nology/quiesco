/** Jest globalTeardown (set by the preset): closes the run's session (device per config). */
import { disposeShared } from './shared.js';

export default async function teardown(): Promise<void> {
  await disposeShared();
}
