// Backdoor typing without a `Backdoors` declaration (issue #6). The declared registry is type-tested in
// examples/todo-app/src/backdoors.type-test.ts (declaration merging is per program).
import { describe, expectTypeOf, it } from 'vitest';

import type { Driver } from '../src/driver.js';
import type { JsonCompatible, JsonValue } from '@quiesco/protocol';

interface Student {
  id: string;
  name: string;
  age: number;
  nickname?: string;
  tags: string[];
}

declare const app: Driver;
declare const students: Student[];
declare const student: Student;

describe('app.backdoor without a registry', () => {
  it('takes interfaces (no index signature) as arguments, without a cast', () => {
    void app.backdoor('students.set', students);
    void app.backdoor('students.set', student, 'x', 1, null, [true]);
    // @ts-expect-error undefined is not JSON (an optional element of an array, under noUncheckedIndexedAccess)
    void app.backdoor('students.set', students[0]);
  });

  it('refuses what JSON cannot carry', () => {
    // @ts-expect-error a Date is not JSON
    void app.backdoor('x', new Date());
    // @ts-expect-error a function is not JSON
    void app.backdoor('x', () => 1);
    // @ts-expect-error nested undefined-only values are not JSON
    void app.backdoor('x', { at: undefined as undefined });
    // @ts-expect-error a Map is not JSON
    void app.backdoor('x', new Map<string, number>());
  });

  it('resolves to JsonValue, or the type given', () => {
    expectTypeOf(app.backdoor('x')).resolves.toEqualTypeOf<JsonValue>();
    expectTypeOf(app.backdoor<Student[]>('students.list')).resolves.toEqualTypeOf<Student[]>();
  });

  it('JsonCompatible keeps JSON shapes and drops the rest', () => {
    expectTypeOf<JsonCompatible<Student>>().toEqualTypeOf<{ id: string; name: string; age: number; nickname?: string; tags: readonly string[] }>();
    expectTypeOf<JsonCompatible<Date>['getTime']>().toBeNever();
  });
});
