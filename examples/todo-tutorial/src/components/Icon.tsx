/**
 * Three line icons drawn with views (2 pt strokes, one style), so the app needs no icon font or SVG
 * library. They are decorative: the control around them carries the accessible name.
 */
import { StyleSheet, View } from 'react-native';

export type IconName = 'check' | 'chevron-right' | 'plus';

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants', 'aria-hidden': true } as const;

export function Icon({ name, color, size = 20 }: { name: IconName; color: string; size?: number }) {
  const stroke = 2;
  if (name === 'check') {
    return (
      <View {...hidden} style={[styles.box, { width: size, height: size }]}>
        <View
          style={{
            width: size * 0.55,
            height: size * 0.3,
            borderLeftWidth: stroke,
            borderBottomWidth: stroke,
            borderColor: color,
            transform: [{ translateY: -size * 0.06 }, { rotate: '-45deg' }],
          }}
        />
      </View>
    );
  }
  if (name === 'chevron-right') {
    return (
      <View {...hidden} style={[styles.box, { width: size, height: size }]}>
        <View
          style={{
            width: size * 0.4,
            height: size * 0.4,
            borderTopWidth: stroke,
            borderRightWidth: stroke,
            borderColor: color,
            transform: [{ translateX: -size * 0.08 }, { rotate: '45deg' }],
          }}
        />
      </View>
    );
  }
  return (
    <View {...hidden} style={[styles.box, { width: size, height: size }]}>
      <View style={{ position: 'absolute', width: size * 0.7, height: stroke, borderRadius: 1, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: stroke, height: size * 0.7, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
});
