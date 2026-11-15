/**
 * Reporter of `quiesco list` for Jest (see list.ts): every test of a collect-only run (all skipped by
 * the name pattern) as a TestRef, written as a TestList to QUIESCO_LIST_OUT when the run completes.
 */
import fs from 'node:fs';

import type { TestRef } from '@quiesco/core';

import { jestTestId, relativeFile } from './reporter.js';
import type { FileResult, JestTest } from './reporter.js';

export default class QuiescoListReporter {
  private readonly tests: TestRef[] = [];
  private readonly files: string[] = [];
  private readonly errors: { file?: string; message: string }[] = [];

  constructor(private readonly globalConfig: { rootDir: string }) {}

  onTestFileResult(test: JestTest, result: FileResult): void {
    const file = relativeFile(this.globalConfig.rootDir, test.path);
    this.files.push(file);
    if (result.testExecError != null) this.errors.push({ file, message: result.testExecError.message ?? 'Test file failed' });
    for (const r of result.testResults) {
      const path = [...r.ancestorTitles, r.title];
      this.tests.push({ id: jestTestId(file, path), file, ...(r.location != null ? { line: r.location.line } : {}), name: r.title, path });
    }
  }

  onRunComplete(): void {
    const out = process.env['QUIESCO_LIST_OUT'];
    const json = JSON.stringify({ runner: 'jest', files: this.files.sort(), tests: this.tests, errors: this.errors });
    if (out !== undefined && out !== '') fs.writeFileSync(out, json);
  }

  getLastError(): void {}
}
