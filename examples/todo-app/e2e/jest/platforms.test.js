// A second file: it reuses the session the first file started (no new app launch). Platform tags go in
// test or describe titles; the innermost level with a platform tag decides.
test('登录后看到自己的待办列表', async () => {
  const { app } = quiesco;
  await app.type('email', 'b@example.com');
  await app.type('password', 'secret');
  await app.tap('login-button');
  await app.expectText('greeting', 'b@example.com');
});

describe('只在原生端 @native', () => {
  test('平台是 iOS 或 Android', () => {
    expect(['ios', 'android']).toContain(quiesco.session.provider.platform);
  });

  test('内层的 Android 标签优先于外层 @android', () => {
    expect(quiesco.session.provider.platform).toBe('android');
  });
});

test('只在 Web 上 @web', () => {
  expect(quiesco.session.provider.platform).toBe('web');
});
