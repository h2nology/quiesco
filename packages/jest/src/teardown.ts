/**
 * Jest globalTeardown (set by the preset): closes an in-band run's session (device per config), and kills
 * what parallel workers' sessions left running (Phase 6.12).
 */
import { disposeShared } from './shared.js';

export default async function teardown(): Promise<void> {
  await disposeShared();
}
