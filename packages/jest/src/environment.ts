/**
 * Jest test environment (`testEnvironment: '@quiesco/jest/environment'`, set by the preset): Node's
 * environment plus the run's Quiesco session, exposed to tests as the global `quiesco`
 * (`quiesco.app`, `quiesco.session`).
 */
import type { EnvironmentContext, JestEnvironmentConfig } from '@jest/environment';
import { connectRunEvents } from '@quiesco/core';
import type { Lifecycle, RunEventClient } from '@quiesco/core';
import { TestEnvironment } from 'jest-environment-node';

import type { WorkerInfo } from '@quiesco/core';

import { handleEvent, jestWorker, titlesOf } from './events.js';
import type { EventLike } from './events.js';
import { jestTestId, relativeFile } from './reporter.js';
import { inWorkerProcess, registerChildren, startShared } from './shared.js';

export default class QuiescoEnvironment extends TestEnvironment {
  private readonly worker: WorkerInfo;
  private lifecycle: Lifecycle | null = null;
  /** Evidence files go to `quiesco test` / `quiesco ui` (same test id as the reporter's). */
  private events: RunEventClient | null = null;
  private readonly file: string;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
    this.worker = jestWorker(config.globalConfig.maxWorkers, process.env, inWorkerProcess());
    this.file = relativeFile(config.globalConfig.rootDir, context.testPath);
  }

  override async teardown(): Promise<void> {
    await this.events?.close();
    this.events = null;
    await super.teardown();
  }

  override async setup(): Promise<void> {
    await super.setup();
    // `quiesco list` collects the tests without running them: no device.
    if (process.env['QUIESCO_LIST'] === '1') {
      const unavailable = (): never => {
        throw new Error('quiesco is not available while listing tests');
      };
      this.global['quiesco'] = {
        get app() {
          return unavailable();
        },
        get session() {
          return unavailable();
        },
      };
      return;
    }
    const lifecycle = await startShared(this.worker);
    this.lifecycle = lifecycle;
    this.global['quiesco'] = {
      get app() {
        return lifecycle.current.driver;
      },
      get session() {
        return lifecycle.current;
      },
    };
  }

  // Structural event type: jest-circus passes its own Event; only `name` and `test` are read.
  async handleTestEvent(event: EventLike): Promise<void> {
    if (this.lifecycle === null) return;
    await handleEvent(this.lifecycle, event, (test, files) => {
      this.events ??= connectRunEvents({ runner: 'jest' });
      this.events.send({ type: 'test:evidence', testId: jestTestId(this.file, titlesOf(test)), files });
    });
    // Children started during the test (the iOS system UI runner, a recorder) join the registry.
    if (event.name === 'test_done' && inWorkerProcess()) registerChildren();
  }
}
