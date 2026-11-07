import { describe, expectTypeOf, it } from 'vitest';

import type {
  ActionSpec,
  AgentConfig,
  AgentEvent,
  AgentMethods,
  AgentRequest,
  AssertionSpec,
  HostMethods,
  JsonValue,
  Matcher,
  QuiescoErrorObject,
  ResultOf,
} from '../src/index.js';

describe('protocol types', () => {
  it('Matcher accepts nested `within` and regex text', () => {
    const m: Matcher = { role: 'button', text: { regex: { source: '^保存$', flags: '' } }, within: { id: 'form' }, index: 0 };
    expectTypeOf(m).toMatchTypeOf<Matcher>();
  });

  it('AgentRequest is a discriminated union keyed by method', () => {
    const r: AgentRequest = { jsonrpc: '2.0', id: 1, method: 'backdoor', params: { name: 'loginAs', args: ['a@example.com'] } };
    expectTypeOf(r).toMatchTypeOf<AgentRequest>();
    // @ts-expect-error params must match the method
    const bad: AgentRequest = { jsonrpc: '2.0', id: 1, method: 'backdoor', params: { matcher: { id: 'x' } } };
    void bad;
  });

  it('action results can ask the host to inject input', () => {
    expectTypeOf<ResultOf<AgentMethods['action']>>().toHaveProperty('hostInput');
  });

  it('error data is typed per error name', () => {
    const e: QuiescoErrorObject<'BACKDOOR_NOT_REGISTERED'> = {
      code: 1006,
      message: 'backdoor "x" is not registered',
      data: { name: 'BACKDOOR_NOT_REGISTERED', registered: ['loginAs', 'seedTodos'] },
    };
    expectTypeOf(e.data.registered).toEqualTypeOf<string[]>();
    // @ts-expect-error code must match the name
    const wrong: QuiescoErrorObject<'SYNC_TIMEOUT'> = { code: 1001, message: '', data: { name: 'SYNC_TIMEOUT', timeoutMs: 1, busy: [] } };
    void wrong;
  });

  it('actions and assertions are discriminated unions', () => {
    expectTypeOf<Extract<ActionSpec, { type: 'type' }>>().toHaveProperty('text');
    expectTypeOf<Extract<AssertionSpec, { type: 'count' }>['expected']>().toEqualTypeOf<number>();
  });

  it('events are notifications without id', () => {
    expectTypeOf<AgentEvent>().not.toHaveProperty('id');
  });

  it('JsonValue rejects functions', () => {
    // @ts-expect-error functions are not JSON
    const v: JsonValue = () => 1;
    void v;
  });

  it('hello result carries the agent config, which must be JSON', () => {
    expectTypeOf<ResultOf<HostMethods['hello']>['config']>().toEqualTypeOf<AgentConfig>();
    expectTypeOf<AgentConfig>().toExtend<JsonValue>();
  });
});
