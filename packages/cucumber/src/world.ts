import { World } from '@cucumber/cucumber';
import type { IWorldOptions } from '@cucumber/cucumber';
import type { Driver, Platform, Session } from '@quiesco/core';

import type { Lifecycle } from './lifecycle.js';

let lifecycle: Lifecycle | null = null;

/** @internal set by registerQuiesco(). */
export function bindLifecycle(l: Lifecycle): void {
  lifecycle = l;
}

/**
 * Cucumber World with `this.app` (the Quiesco Driver). Extend it to add your own business driver
 * (Ports & Adapters): `class MyWorld extends QuiescoWorld { todos = new TodoDriver(this.app) }`.
 * Step files run with Node's type stripping: import the driver as `'./todo-driver.ts'`, and declare its
 * fields instead of using parameter properties (`constructor(private app: Driver)` is not supported).
 */
export class QuiescoWorld<Parameters = unknown> extends World<Parameters> {
  constructor(options: IWorldOptions<Parameters>) {
    super(options);
  }

  get app(): Driver {
    return this.session.driver;
  }

  /**
   * The platform under test, `'ios' | 'android' | 'web'` (issue #22): for a step or driver that does the
   * same thing differently per platform. Scenarios for one platform only are better tagged (@ios …).
   */
  get platform(): Platform {
    return this.session.platform;
  }

  get session(): Session {
    if (lifecycle === null) throw new Error("Quiesco is not registered: import '@quiesco/cucumber/register' in a support file");
    return lifecycle.current;
  }
}
