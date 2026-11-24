import { Pressable, StyleSheet, View } from 'react-native';

import { focusRing, type InteractionState, radius, touchTarget, useColors } from '../theme';
import { Icon } from './Icon';

/** A 20 pt square box (4 pt radius) inside a 48 pt touch target. Checked: filled with the primary blue. */
export function Checkbox({ checked, onToggle, label, testID }: { checked: boolean; onToggle: () => void; label: string; testID?: string }) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onToggle}
      style={styles.target}
    >
      {(state) => {
        const { pressed, hovered, focused } = state as InteractionState;
        return (
          <View
            style={[
              styles.box,
              {
                borderColor: checked ? c.primary : c.inkMuted,
                backgroundColor: checked ? c.primary : pressed || hovered ? c.surfaceSunken : c.surface,
              },
              focusRing(c, focused === true),
            ]}
          >
            {checked ? <Icon name="check" color={c.onPrimary} size={14} /> : null}
          </View>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  box: { width: 20, height: 20, borderRadius: radius.xs, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
