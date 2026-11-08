/**
 * Hidden capability playground (not linked from the app; opened by the `openPlayground` backdoor).
 * Controls for the Quiesco action tests (features/actions.feature), extended phase by phase:
 * - a canvas split into four quadrants (taps at a point),
 * - a counter (multiTap, tapAt),
 * - a note field (pressKey enter / backspace, replaceText),
 * - a box dragged with PanResponder onto one of two drop zones (drag),
 * - a 200-row FlatList without getItemLayout (scrollToIndex, scrollToEdge).
 */
import { useRef, useState } from 'react';
import { FlatList, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { LayoutRectangle } from 'react-native';

import { ScreenTransition } from '../components/ScreenTransition';

const QUADRANTS = [
  ['左上', '右上'],
  ['左下', '右下'],
] as const;

const ROWS = Array.from({ length: 200 }, (_, i) => i + 1);

export default function Playground() {
  const [tapped, setTapped] = useState('');
  const [count, setCount] = useState(0);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [dropped, setDropped] = useState('');
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // Layouts relative to the drag area (independent of the screen's slide-in animation): the box's center
  // plus the finger's travel decides the zone.
  const layout = useRef<{ box: LayoutRectangle | null; zones: LayoutRectangle | null; A: LayoutRectangle | null; B: LayoutRectangle | null }>({ box: null, zones: null, A: null, B: null });
  const keep = (key: 'box' | 'zones' | 'A' | 'B') => (e: { nativeEvent: { layout: LayoutRectangle } }) => {
    layout.current[key] = e.nativeEvent.layout;
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Web: a mouse drag over text starts a selection, which would end the gesture without a release.
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => setOffset({ x: g.dx, y: g.dy }),
      onPanResponderRelease: (_e, g) => {
        const { box, zones, A, B } = layout.current;
        const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2 + g.dx;
        const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2 + g.dy;
        const inside = (r: LayoutRectangle | null) => {
          if (r === null || zones === null) return false;
          const x = zones.x + r.x;
          const y = zones.y + r.y;
          return cx >= x && cx <= x + r.width && cy >= y && cy <= y + r.height;
        };
        setDropped(inside(A) ? '放在 A 区' : inside(B) ? '放在 B 区' : '没有放进区域');
        setOffset({ x: 0, y: 0 });
      },
    }),
  ).current;

  return (
    <ScreenTransition>
      <View style={styles.container} testID="playground">
        <View style={styles.row}>
          <View testID="canvas" style={styles.canvas}>
            {QUADRANTS.map((line) => (
              <View key={line[0]} style={styles.canvasLine}>
                {line.map((q) => (
                  <Pressable key={q} style={styles.quadrant} onPress={() => setTapped(q)} />
                ))}
              </View>
            ))}
          </View>
          <Text testID="tap-result">{tapped}</Text>
        </View>

        <View style={styles.row}>
          <Pressable testID="counter" accessibilityRole="button" style={styles.counter} onPress={() => setCount((c) => c + 1)}>
            <Text>+1</Text>
          </Pressable>
          <Text testID="count">{count}</Text>
        </View>

        <View style={styles.row}>
          <TextInput testID="note" accessibilityLabel="备注" value={note} onChangeText={setNote} onSubmitEditing={() => setSubmitted(note)} style={styles.input} />
          <Text testID="submitted">{submitted}</Text>
        </View>

        <View style={styles.dragArea}>
          <View testID="drag-box" onLayout={keep('box')} style={[styles.box, { transform: [{ translateX: offset.x }, { translateY: offset.y }] }]} {...pan.panHandlers} />
          <View style={styles.zones} onLayout={keep('zones')}>
            <View testID="drop-a" onLayout={keep('A')} style={styles.zone}>
              <Text>A</Text>
            </View>
            <View testID="drop-b" onLayout={keep('B')} style={styles.zone}>
              <Text>B</Text>
            </View>
          </View>
          <Text testID="drop-result">{dropped}</Text>
        </View>

        <FlatList
          testID="long-list"
          style={styles.list}
          data={ROWS}
          keyExtractor={(n) => String(n)}
          renderItem={({ item }) => (
            <View testID={`row-${item}`} style={styles.listRow}>
              <Text>第 {item} 行</Text>
            </View>
          )}
        />
      </View>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: 'white' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  canvas: { width: 200, height: 100, borderWidth: 1, borderColor: '#9ca3af' },
  canvasLine: { flex: 1, flexDirection: 'row' },
  quadrant: { flex: 1 },
  counter: { paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#e5e7eb', borderRadius: 6 },
  input: { flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, padding: 8 },
  dragArea: { gap: 8, userSelect: 'none' },
  box: { width: 48, height: 48, backgroundColor: '#2563eb', borderRadius: 6 },
  zones: { flexDirection: 'row', gap: 12 },
  zone: { flex: 1, height: 56, borderWidth: 1, borderStyle: 'dashed', borderColor: '#6b7280', alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1, minHeight: 160, borderWidth: 1, borderColor: '#e5e7eb' },
  listRow: { height: 36, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
});
