/** Any value that survives JSON.stringify / JSON.parse unchanged. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
