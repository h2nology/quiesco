// this.app (the Quiesco driver) in every step, and the lifecycle hooks: one app session per run,
// a soft reset before each scenario, screenshot + element tree on failure.
//
// Step and support files run with Node's type stripping, not tsc: relative imports name the .ts file
// (import { TodoDriver } from './todo-driver.ts'), and TypeScript syntax that generates code is not
// supported (parameter properties such as constructor(private app: Driver), enum, namespace).
import '@quiesco/cucumber/register';
