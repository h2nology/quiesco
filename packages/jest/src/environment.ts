/**
 * Jest test environment (`testEnvironment: '@quiesco/jest/environment'`, set by the preset): Node's
 * environment plus the run's Quiesco session, exposed to tests as the global `quiesco`
 * (`quiesco.app`, `quiesco.session`).
 */
import type { EnvironmentContext, JestEnvironmentConfig } from '@jest/environment';
import type { Lifecycle } from '@quiesco/core';
import { TestEnvironment } from 'jest-environment-node';

import type { WorkerInfo } from '@quiesco/core';

import { handleEvent, jestWorker } from './events.js';
import type { EventLike } from './events.js';
import { inWorkerProcess, registerChildren, startShared } from './shared.js';

export default class QuiescoEnvironment extends TestEnvironment {
  private readonly worker: WorkerInfo;
  private lifecycle: Lifecycle | null = null;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
    this.worker = jestWorker(config.globalConfig.maxWorkers, process.env, inWorkerProcess());
  }

  override async setup(): Promise<void> {
    await super.setup();
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
    await handleEvent(this.lifecycle, event);
    // Children started during the test (the iOS system UI runner, a recorder) join the registry.
    if (event.name === 'test_done' && inWorkerProcess()) registerChildren();
  }
}
