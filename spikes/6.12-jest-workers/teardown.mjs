import fs from 'node:fs';
export default async () => fs.appendFileSync(new URL('./events.log', import.meta.url), `${process.pid} main globalTeardown\n`);
