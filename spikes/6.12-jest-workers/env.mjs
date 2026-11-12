import { TestEnvironment } from 'jest-environment-node';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const LOG = new URL('./events.log', import.meta.url);
const log = (m) => fs.appendFileSync(LOG, `${process.pid} w${process.env.JEST_WORKER_ID} ${m}\n`);
let session = null; // module singleton = one "session" per worker process
function start() {
  if (session) return;
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  session = { child };
  log(`session start child=${child.pid}`);
  process.on('beforeExit', () => log('beforeExit'));
  process.on('exit', (c) => { log(`exit code=${c}`); try { child.kill(); log('killed child in exit'); } catch {} });
  process.on('disconnect', () => log('disconnect'));
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, async () => { log(s + ' -> async dispose 3s'); for (let i = 1; i <= 3; i++) { await new Promise(r => setTimeout(r, 1000)); log('dispose ' + i + 's'); } child.kill(); log('dispose done'); process.exit(0); });
}
export default class Env extends TestEnvironment {
  constructor(config, context) { super(config, context); log(`env ctor maxWorkers=${config.globalConfig.maxWorkers}`); }
  async setup() { await super.setup(); start(); }
  async teardown() { log('env teardown'); await super.teardown(); }
}
