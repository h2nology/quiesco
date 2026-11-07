import { NativeModule, requireNativeModule } from 'expo';

export type TapResult = { x: number; y: number; down: boolean; up: boolean };

declare class SpikeTouchModule extends NativeModule<{}> {
  ping(): string;
  tap(xDp: number, yDp: number, holdMs: number): Promise<TapResult>;
  touchDown(xDp: number, yDp: number): Promise<{ x: number; y: number; handled: boolean }>;
  touchUp(): Promise<{ handled: boolean }>;
}

export default requireNativeModule<SpikeTouchModule>('SpikeTouch');
