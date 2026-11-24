import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { control, focusRing, type InteractionState, radius, space, type, useColors } from '../theme';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  testID?: string;
  /** primary: the one main action of a screen. danger: a secondary button for a destructive action. */
  variant?: Variant;
  icon?: IconName;
  /** Shows a spinner and ignores taps. */
  busy?: boolean;
  disabled?: boolean;
}

export function Button({ label, onPress, testID, variant = 'primary', icon, busy = false, disabled = false }: ButtonProps) {
  const c = useColors();
  const palette = {
    primary: { bg: c.primary, hover: c.primaryPressed, fg: c.onPrimary, border: c.primary },
    secondary: { bg: c.surface, hover: c.surfaceSunken, fg: c.ink, border: c.line },
    danger: { bg: c.surface, hover: c.dangerSoft, fg: c.danger, border: c.line },
  }[variant];
  const inactive = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={(state) => {
        const { pressed, hovered, focused } = state as InteractionState;
        return [
          styles.button,
          { backgroundColor: pressed || hovered ? palette.hover : palette.bg, borderColor: palette.border },
          disabled && styles.disabled,
          focusRing(c, focused === true),
        ];
      }}
    >
      <View style={styles.content}>
        {busy ? <ActivityIndicator size="small" color={palette.fg} /> : icon !== undefined ? <Icon name={icon} color={palette.fg} /> : null}
        <Text style={[type.label, { color: palette.fg }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: control,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  disabled: { opacity: 0.5 },
});
