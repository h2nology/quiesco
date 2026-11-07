/**
 * React idle (requirements.md §6.2-3; docs/spikes/02-react-idle.md): no pending work on any FiberRoot
 * (detector A) AND no unfinished scheduler task (detector B). The hook and scheduler patch are
 * installed by the fiber adapter at agent load; this tracker only reads them.
 */
import type { IdleTracker } from './tracker';

export interface ReactWorkSource {
  pendingRootWork(): string[];
  pendingSchedulerTasks(): string[];
}

export class ReactTracker implements IdleTracker {
  readonly name = 'react';

  constructor(private readonly source: ReactWorkSource) {}

  isIdle(): boolean {
    return this.source.pendingRootWork().length === 0 && this.source.pendingSchedulerTasks().length === 0;
  }

  describeBusy(): string[] {
    return [...this.source.pendingRootWork(), ...this.source.pendingSchedulerTasks()];
  }

  install(): void {}
  uninstall(): void {}
}
