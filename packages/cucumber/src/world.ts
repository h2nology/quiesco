import { World } from '@cucumber/cucumber';
import type { IWorldOptions } from '@cucumber/cucumber';
import type { Driver, Session } from '@quiesco/core';

import type { Lifecycle } from './lifecycle.js';

let lifecycle: Lifecycle | null = null;

/** @internal set by registerQuiesco(). */
export function bindLifecycle(l: Lifecycle): void {
  lifecycle = l;
}

/**
 * Cucumber World with `this.app` (the Quiesco Driver). Extend it to add your own business driver
 * (Ports & Adapters): `class MyWorld extends QuiescoWorld { todos = new TodoDriver(this.app) }`.
 */
export class QuiescoWorld<Parameters = unknown> extends World<Parameters> {
  constructor(options: IWorldOptions<Parameters>) {
    super(options);
  }

  get app(): Driver {
    return this.session.driver;
  }

  get session(): Session {
    if (lifecycle === null) throw new Error("Quiesco is not registered: import '@quiesco/cucumber/register' in a support file");
    return lifecycle.current;
  }
}
