import { View } from 'react-native';

import { radius } from '../theme';

/** The signature dot (DESIGN.md): the only fully round shape, and it always means a state. */
export function StatusDot({ color, size = 8 }: { color: string; size?: number }) {
  return <View aria-hidden style={{ width: size, height: size, borderRadius: radius.full, backgroundColor: color }} />;
}
