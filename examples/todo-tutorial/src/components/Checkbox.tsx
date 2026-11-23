import { Pressable, StyleSheet, View } from 'react-native';

import { radius, touchTarget, useColors } from '../theme';
import { Icon } from './Icon';

/** A 24 pt box inside a 48 pt touch target. */
export function Checkbox({ checked, onToggle, label, testID }: { checked: boolean; onToggle: () => void; label: string; testID?: string }) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onToggle}
      hitSlop={4}
      style={styles.target}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.box,
            { borderColor: checked ? c.primary : c.textMuted, backgroundColor: checked ? c.primary : pressed ? c.surfacePressed : 'transparent' },
          ]}
        >
          {checked ? <Icon name="check" color={c.onPrimary} size={18} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  box: { width: 24, height: 24, borderRadius: radius.sm - 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
