import type { AgentEventName, AgentEvents } from './events.js';
import type { QuiescoErrorObject } from './errors.js';
import type { JsonValue } from './json.js';
import type { AgentMethods, HostMethods } from './methods.js';

/** JSON-RPC 2.0 envelope types (https://www.jsonrpc.org/specification). */
export type RequestId = number | string;

export interface JsonRpcRequest<M extends string = string, P = unknown> {
  jsonrpc: '2.0';
  id: RequestId;
  method: M;
  params: P;
}

export interface JsonRpcNotification<M extends string = string, P = unknown> {
  jsonrpc: '2.0';
  method: M;
  params: P;
}

export interface JsonRpcSuccess<R = unknown> {
  jsonrpc: '2.0';
  id: RequestId;
  result: R;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: JsonValue;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: RequestId | null;
  error: JsonRpcErrorObject | QuiescoErrorObject;
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccess<R> | JsonRpcFailure;

/** Typed request for a given method table. */
export type RequestFor<T extends { [K in keyof T]: { params: unknown } }, K extends keyof T & string = keyof T & string> = {
  [M in K]: JsonRpcRequest<M, T[M]['params']>;
}[K];

export type AgentRequest = RequestFor<AgentMethods>;
export type HostRequest = RequestFor<HostMethods>;

export type AgentEvent = {
  [E in AgentEventName]: JsonRpcNotification<E, AgentEvents[E]>;
}[AgentEventName];

/** Every message that can travel over the socket. */
export type WireMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;
