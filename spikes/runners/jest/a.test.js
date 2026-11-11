const fs = require('node:fs');
test('a', () => { fs.appendFileSync(process.env.SPIKE_LOG, `a session=${globalThis.__session.id}\n`); expect('a').toBe('a' === 'b' ? 'x' : 'a'); });
