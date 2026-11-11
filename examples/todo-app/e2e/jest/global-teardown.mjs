// A config's own globalTeardown replaces the preset's: close Quiesco's session, then the mock backend.
import quiescoTeardown from '@quiesco/jest/teardown';

export default async function teardown() {
  await quiescoTeardown();
  await globalThis.__mockServer?.close();
}
