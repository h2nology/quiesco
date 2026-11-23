import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { font, radius, space, touchTarget, useColors } from '../theme';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  testID?: string;
  variant?: Variant;
  icon?: IconName;
  /** Shows a spinner and ignores taps. */
  busy?: boolean;
  disabled?: boolean;
}

export function Button({ label, onPress, testID, variant = 'primary', icon, busy = false, disabled = false }: ButtonProps) {
  const c = useColors();
  const palette = {
    primary: { bg: c.primary, pressed: c.primaryPressed, fg: c.onPrimary, border: c.primary },
    secondary: { bg: c.surface, pressed: c.surfacePressed, fg: c.primary, border: c.border },
    danger: { bg: c.surface, pressed: c.dangerSoft, fg: c.danger, border: c.border },
  }[variant];
  const inactive = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? palette.pressed : palette.bg, borderColor: palette.border },
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        {busy ? <ActivityIndicator color={palette.fg} /> : icon !== undefined ? <Icon name={icon} color={palette.fg} /> : null}
        <Text style={[font.bodyStrong, { color: palette.fg }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  disabled: { opacity: 0.45 },
});
