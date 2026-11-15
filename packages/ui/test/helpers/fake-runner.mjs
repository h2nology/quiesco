// A stand-in runner for the UI server tests: prints its arguments, sends run events for them
// (QUIESCO_EVENTS), and with `--hang` waits until it is stopped (SIGINT).
import { connectRunEvents } from '@quiesco/core';

const args = process.argv.slice(2);
const hang = args.includes('--hang');
// `file:3:9` is two tests (cucumber's form).
const ids = args.filter((a) => !a.startsWith('--')).flatMap((a) => {
  const [file, ...lines] = a.split(':');
  return lines.map((l) => `${file}:${l}`);
});
const shown = args.filter((a) => !a.startsWith('--'));
process.stdout.write(`fake runner: ${shown.join(' ') || '(all)'}\n`);
const client = connectRunEvents({ runner: 'cucumber' });
const tests = (ids.length > 0 ? ids : ['a.feature:3', 'a.feature:9']).map((id) => ({ id, file: id.split(':')[0], line: Number(id.split(':')[1]), name: `test ${id}`, path: [`test ${id}`] }));
client.send({ type: 'run:start', total: tests.length, totalIsEstimate: false, files: [...new Set(tests.map((t) => t.file))] });
for (const test of tests) {
  client.send({ type: 'test:start', test, attempt: 0, startedAt: Date.now() });
  if (hang) {
    process.on('SIGINT', async () => {
      process.stderr.write('stopped\n');
      await client.close();
      process.exit(130);
    });
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  client.send({ type: 'test:end', test, status: test.line === 9 ? 'failed' : 'passed', durationMs: 5, willRetry: false, ...(test.line === 9 ? { error: { message: 'boom' } } : {}) });
  if (test.line === 9) client.send({ type: 'test:evidence', testId: test.id, files: ['/artifacts/x/failure.png'] });
}
// Like Vitest / Jest: a test of the file that was not chosen, reported as skipped.
if (process.env.FAKE_SIBLING === '1') {
  const sibling = { id: 'a.feature:20', file: 'a.feature', line: 20, name: 'sibling', path: ['sibling'] };
  client.send({ type: 'test:start', test: sibling, attempt: 0, startedAt: Date.now() });
  client.send({ type: 'test:end', test: sibling, status: 'skipped', durationMs: 0, willRetry: false });
}
client.send({ type: 'run:end', success: false, interrupted: false, durationMs: 10 });
await client.close();
process.exit(1);
