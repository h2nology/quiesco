// The details screen. A backdoor puts todos in the list, so these tests do not type them in first.

const seed = [{ title: 'Buy milk', notes: 'Oat milk, 1 l' }, { title: 'Call the dentist' }];

test('a todo opens on its own screen', async () => {
  const { app } = quiesco;
  await app.backdoor('seedTodos', seed);

  await app.tap({ text: 'Buy milk' });
  await app.expectVisible('todo-detail-screen');
  await app.expectText('detail-title', 'Buy milk');
  await app.expectText('detail-notes', 'Oat milk, 1 l');

  await app.goBack();
  await app.expectVisible('todo-list-screen');
});

test('marking a todo done shows in the list', async () => {
  const { app } = quiesco;
  await app.backdoor('seedTodos', seed);

  await app.tap({ text: 'Call the dentist' });
  await app.tap('toggle-done');
  await app.expectText('todo-status', 'Done');

  await app.goBack();
  await app.expectChecked({ id: 'todo-checkbox', index: 1 });
  await app.expectNotChecked({ id: 'todo-checkbox', index: 0 });
  await app.expectText('todo-summary', '1 of 2 done');
});

test('the checkbox in the list toggles a todo', async () => {
  const { app } = quiesco;
  await app.backdoor('seedTodos', seed);

  await app.tap({ id: 'todo-checkbox', index: 0 });
  await app.expectChecked({ id: 'todo-checkbox', index: 0 });
  await app.expectText('todo-summary', '1 of 2 done');
});

test('deleting a todo goes back to the list without it', async () => {
  const { app } = quiesco;
  await app.backdoor('seedTodos', seed);

  await app.tap({ text: 'Buy milk' });
  await app.tap('delete-todo');

  await app.expectVisible('todo-list-screen');
  await app.expectCount('todo-row', 1);
  await app.expectNotExists({ text: 'Buy milk' });
});

test('every test starts with an empty list', async () => {
  const { app } = quiesco;
  // The tests above left todos behind; the soft reset and the onReset hook in src/e2e.ts cleared them.
  await app.expectVisible('empty-state');
});
