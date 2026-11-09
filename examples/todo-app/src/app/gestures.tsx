/**
 * Hidden multi-finger gesture page (opened by the `openGestures` backdoor), for features/gestures.feature
 * (Phase 6.4):
 * - a box with simultaneous react-native-gesture-handler Pinch + Rotation, showing the gesture's scale and
 *   rotation (degrees) when the fingers lift;
 * - a two-finger pan target (RNGH Pan with minPointers 2) showing the direction the fingers moved;
 * - iOS only: a ScrollView with native pinch-to-zoom (UIScrollView's own recognizer), showing its zoom scale.
 */
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useRotationGesture, useSimultaneousGestures } from 'react-native-gesture-handler';

import { ScreenTransition } from '../components/ScreenTransition';

const round2 = (n: number) => n.toFixed(2);

export default function Gestures() {
  const [scale, setScale] = useState('');
  const [rotation, setRotation] = useState('');
  const [twoFinger, setTwoFinger] = useState('');
  const [zoom, setZoom] = useState('1.00');

  // Callbacks run on the JS thread (no Reanimated in this app).
  const pinch = usePinchGesture({ runOnJS: true, disableReanimated: true, onDeactivate: (e) => setScale(round2(e.scale)) });
  const rotate = useRotationGesture({ runOnJS: true, disableReanimated: true, onDeactivate: (e) => setRotation(String(Math.round((e.rotation * 180) / Math.PI))) });
  const both = useSimultaneousGestures(pinch, rotate);
  const pan = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    minPointers: 2,
    onDeactivate: (e) => {
      const { translationX: x, translationY: y } = e;
      setTwoFinger(Math.abs(x) > Math.abs(y) ? (x > 0 ? '右' : '左') : y > 0 ? '下' : '上');
    },
  });

  const onZoom = (e: NativeSyntheticEvent<NativeScrollEvent>) => setZoom(round2(e.nativeEvent.zoomScale ?? 1));

  return (
    <ScreenTransition>
      <View style={styles.container} testID="gestures">
        <View style={styles.row}>
          <GestureDetector gesture={both}>
            <View testID="pinch-box" style={styles.box}>
              <Text>捏合 / 旋转</Text>
            </View>
          </GestureDetector>
          <View>
            <Text testID="pinch-scale">{scale}</Text>
            <Text testID="pinch-rotation">{rotation}</Text>
          </View>
        </View>

        <View style={styles.row}>
          <GestureDetector gesture={pan}>
            <View testID="two-finger-area" style={styles.area}>
              <Text>双指滑动</Text>
            </View>
          </GestureDetector>
          <Text testID="two-finger-result">{twoFinger}</Text>
        </View>

        {Platform.OS === 'ios' && (
          <View style={styles.row}>
            <ScrollView testID="zoomable" style={styles.zoomable} maximumZoomScale={4} minimumZoomScale={1} scrollEventThrottle={16} onScroll={onZoom} onScrollEndDrag={onZoom} onMomentumScrollEnd={onZoom}>
              <View style={styles.zoomContent}>
                <Text>可缩放</Text>
              </View>
            </ScrollView>
            <Text testID="zoom-scale">{zoom}</Text>
          </View>
        )}
      </View>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 16, backgroundColor: 'white' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: { width: 200, height: 200, backgroundColor: '#bfdbfe', alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  area: { width: 200, height: 160, backgroundColor: '#e9d5ff', alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  zoomable: { width: 200, height: 160, borderWidth: 1, borderColor: '#9ca3af' },
  zoomContent: { width: 200, height: 160, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fef3c7' },
});
