/**
 * Native settle tracker (tracker name `native`): native UI that JS cannot see is still moving —
 * a view controller transition (navigation push / pop, Modal presentation), the software keyboard
 * moving or just used. Read synchronously from @quiesco/native (`idleState`, sampled every frame on
 * the UI thread). Present only when the native module offers it (iOS); otherwise always idle.
 *
 * Why: UIKit drops a navigation update or a Modal presentation that arrives during a transition, and
 * touches during keyboard activity; the JS-side trackers report idle meanwhile (Phase 4.5 findings).
 */
import type { IdleTracker } from './tracker';

export interface NativeSettleSource {
  idleState?(): { settling: boolean; reasons: string[] };
}

export class NativeSettleTracker implements IdleTracker {
  readonly name = 'native';

  /** `source` is resolved lazily: the native module may load after the trackers are created. */
  constructor(private readonly source: () => NativeSettleSource | null) {}

  private state(): { settling: boolean; reasons: string[] } | null {
    const s = this.source();
    if (s === null || typeof s.idleState !== 'function') return null;
    return s.idleState();
  }

  isIdle(): boolean {
    return this.state()?.settling !== true;
  }

  describeBusy(): string[] {
    const s = this.state();
    if (s === null || !s.settling) return [];
    return s.reasons.length > 0 ? s.reasons : ['native UI settling'];
  }

  install(): void {}

  uninstall(): void {}
}
