// The driver pattern as documented (docs/driver-pattern.mdx): a World that extends QuiescoWorld is
// accepted by registerQuiesco under strict type checking.
import { describe, expectTypeOf, it } from 'vitest';

import type { Driver } from '@quiesco/core';

import type { RegisterOptions } from '../src/register-hooks.js';
import { QuiescoWorld } from '../src/world.js';

class TodoDriver {
  private readonly app: Driver;

  constructor(app: Driver) {
    this.app = app;
  }

  async add(title: string): Promise<void> {
    await this.app.tap('add-todo');
    await this.app.type('todo-title', title);
  }
}

class TodoWorld extends QuiescoWorld {
  get todos(): TodoDriver {
    return new TodoDriver(this.app);
  }
}

describe('RegisterOptions.world', () => {
  it('accepts a subclass of QuiescoWorld', () => {
    expectTypeOf({ world: TodoWorld }).toExtend<RegisterOptions>();
    expectTypeOf({ world: QuiescoWorld }).toExtend<RegisterOptions>();
  });

  it('rejects a class that is not a QuiescoWorld', () => {
    class Other {
      constructor(_options: unknown) {}
    }
    expectTypeOf({ world: Other }).not.toExtend<RegisterOptions>();
  });
});
