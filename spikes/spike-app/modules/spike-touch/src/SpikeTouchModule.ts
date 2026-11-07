import { NativeModule, requireNativeModule } from 'expo';

export type TapResult = { x: number; y: number; down: boolean; up: boolean };

declare class SpikeTouchModule extends NativeModule<{}> {
  ping(): string;
  getLaunchParams(): { port?: string | null; session?: string | null; [k: string]: unknown };
  tap(xDp: number, yDp: number, holdMs: number): Promise<TapResult>;
  touchDown(xDp: number, yDp: number): Promise<{ x: number; y: number; handled: boolean }>;
  touchUp(): Promise<{ handled: boolean }>;
}

export default requireNativeModule<SpikeTouchModule>('SpikeTouch');
