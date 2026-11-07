import { describe, expect, it } from 'vitest';

import { CloseCode, ErrorCode, JsonRpcErrorCode, PROTOCOL_VERSION, SyncDefaults } from '../src/index.js';

describe('constants', () => {
  it('has a positive integer protocol version', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('uses unique Quiesco error codes that do not collide with JSON-RPC reserved codes', () => {
    const codes = Object.values(ErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) {
      // JSON-RPC reserves -32768..-32000
      expect(c >= -32768 && c <= -32000).toBe(false);
    }
    for (const c of Object.values(JsonRpcErrorCode)) expect(codes).not.toContain(c);
  });

  it('uses application close codes in the RFC 6455 private range', () => {
    for (const [name, code] of Object.entries(CloseCode)) {
      if (name === 'NORMAL') expect(code).toBe(1000);
      else expect(code >= 4000 && code <= 4999).toBe(true);
    }
  });

  it('matches the sync defaults of requirements.md §6.2', () => {
    expect(SyncDefaults).toEqual({ timeoutMs: 10_000, timerThresholdMs: 1_500, stableFrames: 2, countIntervals: false });
  });
});
