// A stand-in test runner: prints a line per test and sends the matching run events (QUIESCO_EVENTS).
import { connectRunEvents } from '@quiesco/core';

const client = connectRunEvents({ runner: 'jest' });
client.send({ type: 'run:start', total: 3, totalIsEstimate: false, files: ['e2e/a.test.js'] });
for (const [name, status] of [['a', 'passed'], ['b', 'failed'], ['c', 'passed']]) {
  const test = { id: name, file: 'e2e/a.test.js', name, path: [name] };
  client.send({ type: 'test:start', test, attempt: 0, startedAt: Date.now() });
  process.stdout.write(`test ${name}\n`);
  client.send({ type: 'test:end', test, status, durationMs: 1, willRetry: false });
}
client.send({ type: 'run:end', success: false, interrupted: false, durationMs: 3 });
await client.close();
process.exit(1);
