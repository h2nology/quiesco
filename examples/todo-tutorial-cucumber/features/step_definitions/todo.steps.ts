// The steps of features/*.feature. They read like the user's actions and checks; the test ids stay here.
// Each step calls only the Quiesco driver (this.app): no waits, no sleeps.
import { type DataTable, Given, Then, When } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

import type { SeedTodo } from '../../src/backdoors.ts';

// The list

Then('the list is empty', async function (this: QuiescoWorld) {
  await this.app.expectVisible('empty-state');
  await this.app.expectCount('todo-row', 0);
});

Then('I see the list', async function (this: QuiescoWorld) {
  await this.app.expectVisible('todo-list-screen');
});

Then('the first todo is {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.expectText({ id: 'todo-title', index: 0 }, title);
});

Then('the summary reads {string}', async function (this: QuiescoWorld, summary: string) {
  await this.app.expectText('todo-summary', summary);
});

When('I go back', async function (this: QuiescoWorld) {
  // Back as a user would: back button, browser back or swipe, depending on the platform.
  await this.app.goBack();
});

// New todo

When('I add a todo {string} with the notes {string}', async function (this: QuiescoWorld, title: string, notes: string) {
  await this.app.tap('add-todo');
  await this.app.expectVisible('new-todo-screen');

  await this.app.type('title-input', title);
  await this.app.type('notes-input', notes);
  // Saving takes 600 ms, then the app goes back to the list. Quiesco waits for both: no sleep.
  await this.app.tap('save-todo');

  await this.app.expectVisible('todo-list-screen');
});

When('I save a new todo without a title', async function (this: QuiescoWorld) {
  await this.app.tap('add-todo');
  await this.app.tap('save-todo');
});

Then('the form says {string}', async function (this: QuiescoWorld, error: string) {
  await this.app.expectText('title-error', error);
  await this.app.expectVisible('new-todo-screen');
});

// Details

Given('these todos:', async function (this: QuiescoWorld, table: DataTable) {
  // An empty cell is an empty string: leave the notes out instead.
  const todos: SeedTodo[] = table.hashes().map(({ title, notes }) => (notes ? { title, notes } : { title }));
  await this.app.backdoor('seedTodos', todos);
});

When('I open the todo {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.tap({ text: title });
  await this.app.expectVisible('todo-detail-screen');
});

Then('I see the details of {string} with the notes {string}', async function (this: QuiescoWorld, title: string, notes: string) {
  await this.app.expectText('detail-title', title);
  await this.app.expectText('detail-notes', notes);
});

When('I mark it as done', async function (this: QuiescoWorld) {
  await this.app.tap('toggle-done');
});

Then('its status is {string}', async function (this: QuiescoWorld, status: string) {
  await this.app.expectText('todo-status', status);
});

When('I check todo {int}', async function (this: QuiescoWorld, n: number) {
  await this.app.tap({ id: 'todo-checkbox', index: n - 1 });
});

Then('todo {int} is checked', async function (this: QuiescoWorld, n: number) {
  await this.app.expectChecked({ id: 'todo-checkbox', index: n - 1 });
});

Then('todo {int} is not checked', async function (this: QuiescoWorld, n: number) {
  await this.app.expectNotChecked({ id: 'todo-checkbox', index: n - 1 });
});

When('I delete it', async function (this: QuiescoWorld) {
  await this.app.tap('delete-todo');
});

Then('the list has {int} todo(s)', async function (this: QuiescoWorld, count: number) {
  await this.app.expectCount('todo-row', count);
});

Then('there is no todo {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.expectNotExists({ text: title });
});
