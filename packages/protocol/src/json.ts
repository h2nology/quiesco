/** Any value that survives JSON.stringify / JSON.parse unchanged. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/**
 * `T` when it survives JSON unchanged, checked structurally (issue #6): unlike `JsonValue`, this accepts
 * interfaces, which have no implicit index signature. Functions, symbols, bigints, `undefined` values and
 * class instances with methods (Date, Map) map to `never`, so passing them is a type error. Optional
 * properties stay optional (a missing key is fine; the agent rejects an explicit `undefined`).
 */
export type JsonCompatible<T> = T extends JsonPrimitive
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly (infer U)[]
      ? readonly JsonCompatible<U>[]
      : T extends object
        ? { [K in keyof T]: K extends string ? JsonCompatible<T[K]> : never }
        : never;

/**
 * Backdoors the app registers, by name (issue #6). Empty by default: names, arguments and results are then
 * only checked for being JSON. Declare them once, in a file both the app and the tests compile:
 *
 *   declare module '@quiesco/agent' {
 *     interface Backdoors {
 *       'students.set': (list: Student[]) => void;
 *       'students.get': (id: string) => Student | null;
 *     }
 *   }
 *
 * and `quiesco.backdoor(...)` in the app and `app.backdoor(...)` in the tests check the name, the arguments
 * and the result. (`@quiesco/core` and `@quiesco/protocol` work as the module name too: it is one
 * interface.)
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Backdoors {}

/** Backdoor names: any string while `Backdoors` is empty, else only the declared ones. */
export type BackdoorName = [keyof Backdoors] extends [never] ? string : Extract<keyof Backdoors, string>;

type DeclaredFn<K> = K extends keyof Backdoors ? (Backdoors[K] extends (...args: infer A) => infer R ? (...args: A) => R : never) : never;

/** What `app.backdoor(name, …)` resolves to: the declared result (`null` for none), else `T`. */
export type BackdoorResult<K, T> = K extends keyof Backdoors ? (Awaited<ReturnType<DeclaredFn<K>>> extends void | undefined ? null : Awaited<ReturnType<DeclaredFn<K>>>) : T;

/** The arguments of a declared backdoor. */
export type BackdoorParams<K> = Parameters<DeclaredFn<K>>;

/** What the app may register under `name`: the declared function (or an async version of it). */
export type BackdoorImpl<K> = K extends keyof Backdoors ? (...args: BackdoorParams<K>) => ReturnType<DeclaredFn<K>> | Promise<Awaited<ReturnType<DeclaredFn<K>>>> : (...args: never[]) => unknown;
