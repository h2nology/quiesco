import { NativeModule, requireNativeModule } from 'expo';

declare class SpikeTouchModule extends NativeModule<{}> {
  ping(): string;
}

export default requireNativeModule<SpikeTouchModule>('SpikeTouch');
