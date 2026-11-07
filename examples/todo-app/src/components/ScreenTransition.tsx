/**
 * Slides the screen content in from the right. The duration is configurable
 * (EXPO_PUBLIC_TRANSITION_MS, default 300) so the acceptance tests can make transitions slow.
 * Animates `left` (a layout property) on the JS side, so the element positions really change while it runs.
 */
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, useWindowDimensions } from 'react-native';

const DURATION = Number(process.env.EXPO_PUBLIC_TRANSITION_MS ?? 300);

export function ScreenTransition({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const offset = useRef(new Animated.Value(width)).current;
  useEffect(() => {
    Animated.timing(offset, { toValue: 0, duration: DURATION, useNativeDriver: false }).start();
  }, [offset]);
  return <Animated.View style={[styles.fill, { left: offset }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
