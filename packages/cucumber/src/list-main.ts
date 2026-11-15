// `node list-main.js --out <file> [cucumber arguments]`: see list.ts.
import { listMain } from './list.js';

await listMain(process.argv.slice(2));
