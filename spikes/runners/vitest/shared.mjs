// Module-level singleton: shared across test files only if they share a module graph.
import fs from 'node:fs';
let session = null;
let created = 0;
export function getSession() {
  if (session === null) {
    created++;
    session = { id: `${process.pid}-${Date.now()}`, created };
    process.once('beforeExit', () => fs.appendFileSync(process.env.SPIKE_LOG, `beforeExit ${session.id}\n`));
    process.once('exit', () => fs.appendFileSync(process.env.SPIKE_LOG, `exit ${session.id}\n`));
  }
  return session;
}
