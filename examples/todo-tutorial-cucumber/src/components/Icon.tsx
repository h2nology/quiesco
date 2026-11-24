/**
 * Line icons drawn with views: 1.5 pt strokes with square ends, the weight of the logo's ring (DESIGN.md
 * "Shapes"). They are decorative: the control around them carries the accessible name.
 */
import { StyleSheet, View } from 'react-native';

export type IconName = 'check' | 'chevron-right' | 'plus';

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants', 'aria-hidden': true } as const;
const STROKE = 1.5;

export function Icon({ name, color, size = 16 }: { name: IconName; color: string; size?: number }) {
  const box = [styles.box, { width: size, height: size }];
  if (name === 'check') {
    return (
      <View {...hidden} style={box}>
        <View
          style={{
            width: size * 0.62,
            height: size * 0.32,
            borderLeftWidth: STROKE,
            borderBottomWidth: STROKE,
            borderColor: color,
            transform: [{ translateY: -size * 0.08 }, { rotate: '-45deg' }],
          }}
        />
      </View>
    );
  }
  if (name === 'chevron-right') {
    return (
      <View {...hidden} style={box}>
        <View
          style={{
            width: size * 0.42,
            height: size * 0.42,
            borderTopWidth: STROKE,
            borderRightWidth: STROKE,
            borderColor: color,
            transform: [{ translateX: -size * 0.1 }, { rotate: '45deg' }],
          }}
        />
      </View>
    );
  }
  return (
    <View {...hidden} style={box}>
      <View style={{ position: 'absolute', width: size * 0.75, height: STROKE, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: STROKE, height: size * 0.75, backgroundColor: color }} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
});
