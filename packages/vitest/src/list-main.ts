// `node list-main.js --out <file> [vitest arguments]`: see list.ts.
import { listMain } from './list.js';

await listMain(process.argv.slice(2));
