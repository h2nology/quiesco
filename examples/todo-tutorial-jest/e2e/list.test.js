// The list and the new-todo screen, driven only through the UI. `quiesco.app` is the Quiesco driver,
// a global like Jest's own `test`.
test('a fresh start shows the empty list', async () => {
  const { app } = quiesco;
  await app.expectVisible('empty-state');
  await app.expectCount('todo-row', 0);
});

test('a new todo appears at the top of the list', async () => {
  const { app } = quiesco;
  await app.tap('add-todo');
  await app.expectVisible('new-todo-screen');

  await app.type('title-input', 'Buy milk');
  await app.type('notes-input', 'Oat milk, 1 l');
  // Saving takes 600 ms, then the app goes back to the list. Quiesco waits for both: no sleep.
  await app.tap('save-todo');

  await app.expectVisible('todo-list-screen');
  await app.expectText({ id: 'todo-title', index: 0 }, 'Buy milk');
  await app.expectText('todo-summary', '0 of 1 done');
});

test('a todo needs a title', async () => {
  const { app } = quiesco;
  await app.tap('add-todo');
  await app.tap('save-todo');

  await app.expectText('title-error', 'Enter a title');
  await app.expectVisible('new-todo-screen');

  // Back to the list as a user would: back button, browser back or swipe, depending on the platform.
  await app.goBack();
  await app.expectVisible('empty-state');
});
