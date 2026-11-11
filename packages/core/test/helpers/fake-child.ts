import { EventEmitter } from 'node:events';

import type { ChildLike, SpawnProcess } from '../../src/devices/streams';

/** A fake long-running process: tests write to its streams and end it. */
export class FakeChild extends EventEmitter implements ChildLike {
  exitCode: number | null = null;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly signals: string[] = [];
  constructor(readonly file: string, readonly args: readonly string[]) {
    super();
  }
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal);
    this.exit(0);
    return true;
  }
  exit(code: number): void {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit('exit', code);
  }
}

/** A spawner recording its children; `onSpawn` can make them talk (e.g. "Recording started"). */
export function fakeSpawner(onSpawn: (c: FakeChild) => void = () => {}): { spawn: SpawnProcess; children: FakeChild[] } {
  const children: FakeChild[] = [];
  return {
    children,
    spawn: (file, args) => {
      const c = new FakeChild(file, args);
      children.push(c);
      queueMicrotask(() => onSpawn(c));
      return c;
    },
  };
}
