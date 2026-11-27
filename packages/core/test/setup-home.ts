// Tests never write into the real home directory (e.g. the system UI runner's use marker under
// ~/Library/Caches/quiesco): HOME points to a fresh directory for each test file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['HOME'] = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-core-home-'));
