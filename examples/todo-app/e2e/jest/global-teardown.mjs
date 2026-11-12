// A config's own globalTeardown replaces the preset's: close Quiesco's session (and what parallel workers
// left running), then the mock backends.
import quiescoTeardown from '@quiesco/jest/teardown';

export default async function teardown() {
  await quiescoTeardown();
  await Promise.all((globalThis.__mockServers ?? []).map((s) => s.close()));
}
