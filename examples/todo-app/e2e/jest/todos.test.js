// The new-todo feature (features/new-todo.feature) as Jest tests. `quiesco.app` is the same Driver
// cucumber steps reach as `this.app`; Quiesco resets the app before every test.
describe('新建待办', () => {
  test('新建的待办出现在列表最前面', async () => {
    const { app } = quiesco;
    await app.backdoor('loginAs', 'a@example.com');
    await app.backdoor('seedTodos', []);
    await app.tap('add-todo');
    await app.type('todo-title', '买牛奶');
    await app.tap({ role: 'button', text: '保存' });
    await app.expectText({ id: 'todo-item', index: 0 }, '买牛奶');
  });

  test('标题为空时不能保存', async () => {
    const { app } = quiesco;
    await app.backdoor('loginAs', 'a@example.com');
    await app.tap('add-todo');
    await app.tap({ role: 'button', text: '保存' });
    await app.expectVisible({ text: '请输入标题' });
    await app.expectCount('todo-item', 0);
  });

  test('上一个测试的待办已被重置', async () => {
    await quiesco.app.backdoor('loginAs', 'a@example.com');
    await quiesco.app.expectCount('todo-item', 0);
  });
});
