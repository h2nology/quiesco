const fs = require('node:fs');
test('b', () => { fs.appendFileSync(process.env.SPIKE_LOG, `b session=${globalThis.__session.id}\n`); expect('b').toBe('b' === 'b' ? 'x' : 'b'); });
