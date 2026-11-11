// A second file: it reuses the session the first file started (no new app launch). Platform tags: in a
// title or `{ tags }`; the innermost level with a platform tag decides.
import { describe, test } from '@quiesco/vitest';
import { expect } from 'vitest';

test('登录后看到自己的待办列表', async ({ app }) => {
  await app.type('email', 'b@example.com');
  await app.type('password', 'secret');
  await app.tap('login-button');
  await app.expectText('greeting', 'b@example.com');
});

describe('只在原生端 @native', () => {
  test('平台是 iOS 或 Android', ({ session }) => {
    expect(['ios', 'android']).toContain(session.provider.platform);
  });

  test('内层的 Android 标签优先于外层', { tags: ['@android'] }, ({ session }) => {
    expect(session.provider.platform).toBe('android');
  });
});

test('只在 Web 上 @web', ({ session }) => {
  expect(session.provider.platform).toBe('web');
});
