// A stand-in for a runner process: sends N test:end events and run:end, closes, and exits right away.
import { connectRunEvents } from '../../dist/index.js';

const n = Number(process.argv[2] ?? '10');
const client = connectRunEvents({ runner: 'jest' });
const test = { id: 't', file: 'e2e/a.test.ts', name: 't', path: ['t'] };
for (let i = 0; i < n; i++) client.send({ type: 'test:end', test: { ...test, id: `t${i}` }, status: 'passed', durationMs: 1, willRetry: false });
client.send({ type: 'run:end', success: true, interrupted: false, durationMs: 1 });
await client.close();
process.exit(0);
