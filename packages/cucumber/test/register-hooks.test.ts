import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks: { kind: string; options: { name: string; timeout?: number } }[] = [];
vi.mock('@cucumber/cucumber', () => {
  const hook = (kind: string) => (options: { name: string; timeout?: number }) => void hooks.push({ kind, options });
  return {
    BeforeAll: hook('BeforeAll'),
    Before: hook('Before'),
    After: hook('After'),
    AfterAll: hook('AfterAll'),
    setDefaultTimeout: vi.fn(),
    setWorldConstructor: vi.fn(),
    Status: { PASSED: 'PASSED', SKIPPED: 'SKIPPED' },
    World: class {},
  };
});

const { registerQuiesco } = await import('../src/register-hooks');

describe('registerQuiesco hook timeouts', () => {
  beforeEach(() => void hooks.splice(0));

  it('gives the per-scenario reset room to start the app again (3 × the 30 s connect timeout)', () => {
    registerQuiesco();
    const before = hooks.find((h) => h.kind === 'Before');
    expect(before?.options.timeout).toBe(180_000);
    expect(hooks.find((h) => h.kind === 'BeforeAll')?.options.timeout).toBe(600_000);
  });

  it('takes resetTimeoutMs', () => {
    registerQuiesco({ resetTimeoutMs: 240_000 });
    expect(hooks.find((h) => h.kind === 'Before')?.options.timeout).toBe(240_000);
  });
});
