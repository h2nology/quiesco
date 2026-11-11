/**
 * Hidden reorderable list (opened from the showcase page), for features/showcase.feature (Phase 6.11):
 * press and hold a row, then drag it up or down; on release it moves to the row it was dropped on.
 * Plain PanResponder, no library: the hold is measured on the first move (no timer), so a quick swipe does
 * not pick a row up.
 */
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

import { ScreenTransition } from '../components/ScreenTransition';

export const FRUITS = ['苹果', '香蕉', '樱桃', '葡萄', '橘子'] as const;
const ROW_H = 52;
/** How long a row must be held before it follows the finger. */
const HOLD_MS = 400;
/** Moving further than this before the hold ends cancels the pick-up. */
const SLOP = 10;

type Fruit = (typeof FRUITS)[number];

interface RowProps {
  fruit: Fruit;
  index: number;
  lifted: boolean;
  offset: number;
  onMove: (fruit: Fruit, dy: number | null) => void;
  onDrop: (fruit: Fruit, dy: number) => void;
}

function Row({ fruit, index, lifted, offset, onMove, onDrop }: RowProps) {
  const state = useRef({ since: 0, active: false, cancelled: false });
  // The handlers are created once; they report through the latest callbacks.
  const latest = useRef({ onMove, onDrop });
  latest.current = { onMove, onDrop };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Web: a mouse drag over text starts a selection, which would end the gesture without a release.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        state.current = { since: Date.now(), active: false, cancelled: false };
      },
      onPanResponderMove: (_e, g) => {
        const s = state.current;
        if (s.cancelled) return;
        if (!s.active) {
          if (Date.now() - s.since >= HOLD_MS) s.active = true;
          else if (Math.abs(g.dx) > SLOP || Math.abs(g.dy) > SLOP) s.cancelled = true;
        }
        if (s.active) latest.current.onMove(fruit, g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (state.current.active) latest.current.onDrop(fruit, g.dy);
        else latest.current.onMove(fruit, null);
      },
      onPanResponderTerminate: () => latest.current.onMove(fruit, null),
    }),
  ).current;

  return (
    <View
      testID={`reorder-item-${FRUITS.indexOf(fruit) + 1}`}
      accessibilityLabel={`第 ${index + 1} 位：${fruit}`}
      style={[styles.row, lifted && styles.lifted, { transform: [{ translateY: offset }] }]}
      {...pan.panHandlers}
    >
      <Text style={styles.handle}>≡</Text>
      <Text>{fruit}</Text>
    </View>
  );
}

export default function Reorder() {
  const [order, setOrder] = useState<Fruit[]>([...FRUITS]);
  const [drag, setDrag] = useState<{ fruit: Fruit; dy: number } | null>(null);

  const onMove = (fruit: Fruit, dy: number | null) => setDrag(dy === null ? null : { fruit, dy });
  const onDrop = (fruit: Fruit, dy: number) => {
    setOrder((prev) => {
      const from = prev.indexOf(fruit);
      const to = Math.max(0, Math.min(prev.length - 1, from + Math.round(dy / ROW_H)));
      const next = prev.filter((f) => f !== fruit);
      next.splice(to, 0, fruit);
      return next;
    });
    setDrag(null);
  };

  return (
    <ScreenTransition>
      <View testID="reorder" style={styles.container}>
        <Text>长按一行再上下拖动，松手后放到所在的位置。</Text>
        <View>
          {order.map((fruit, i) => (
            <Row key={fruit} fruit={fruit} index={i} lifted={drag?.fruit === fruit} offset={drag?.fruit === fruit ? drag.dy : 0} onMove={onMove} onDrop={onDrop} />
          ))}
        </View>
        <Text testID="reorder-result">{order.join('、')}</Text>
      </View>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: 'white', userSelect: 'none' },
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: 'white' },
  lifted: { zIndex: 1, backgroundColor: '#eef2ff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 },
  handle: { fontSize: 18, color: '#6b7280' },
});
