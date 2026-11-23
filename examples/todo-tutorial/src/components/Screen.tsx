import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { maxContentWidth, useColors } from '../theme';

/** The screen background with a centered column of readable width (phones: full width). */
export function Screen({ children, testID }: { children: ReactNode; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%', maxWidth: maxContentWidth },
});
