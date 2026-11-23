import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Todo } from '../store';
import { focusRing, type InteractionState, radius, space, type, useColors } from '../theme';
import { Checkbox } from './Checkbox';
import { Icon } from './Icon';

/** One todo in the list panel: the checkbox toggles it, the rest of the row opens its details. */
export function TodoRow({ todo, onToggle, onOpen }: { todo: Todo; onToggle: () => void; onOpen: () => void }) {
  const c = useColors();
  return (
    <View testID="todo-row" style={styles.row}>
      <Checkbox testID="todo-checkbox" checked={todo.done} onToggle={onToggle} label={todo.done ? `Mark "${todo.title}" as open` : `Mark "${todo.title}" as done`} />
      <Pressable
        testID="todo-open"
        accessibilityRole="button"
        accessibilityHint="Opens the details"
        onPress={onOpen}
        style={(state) => {
          const { pressed, hovered, focused } = state as InteractionState;
          return [styles.open, (pressed || hovered) && { backgroundColor: c.surfaceSunken }, focusRing(c, focused === true)];
        }}
      >
        <View style={styles.texts}>
          <Text testID="todo-title" numberOfLines={1} style={[type.body, { color: todo.done ? c.inkMuted : c.ink }, todo.done && styles.doneTitle]}>
            {todo.title}
          </Text>
          {todo.notes !== '' ? (
            <Text numberOfLines={1} style={[type.bodySm, { color: c.inkMuted }]}>
              {todo.notes}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron-right" color={c.inkMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  open: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: space.sm,
    paddingRight: space.md,
    borderRadius: radius.sm,
  },
  texts: { flex: 1, paddingVertical: space.sm },
  doneTitle: { textDecorationLine: 'line-through' },
});
