/**
 * Jest test environment (`testEnvironment: '@quiesco/jest/environment'`, set by the preset): Node's
 * environment plus the run's Quiesco session, exposed to tests as the global `quiesco`
 * (`quiesco.app`, `quiesco.session`).
 */
import type { EnvironmentContext, JestEnvironmentConfig } from '@jest/environment';
import type { Lifecycle } from '@quiesco/core';
import { TestEnvironment } from 'jest-environment-node';

import { handleEvent, jestParallel } from './events.js';
import type { EventLike } from './events.js';
import { startShared } from './shared.js';

export default class QuiescoEnvironment extends TestEnvironment {
  private readonly serial: string | null;
  private lifecycle: Lifecycle | null = null;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
    this.serial = jestParallel(config.globalConfig.maxWorkers);
  }

  override async setup(): Promise<void> {
    await super.setup();
    const lifecycle = await startShared(() => this.serial);
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
    if (this.lifecycle !== null) await handleEvent(this.lifecycle, event);
  }
}
