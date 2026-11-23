import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Todo } from '../store';
import { font, space, useColors } from '../theme';
import { Checkbox } from './Checkbox';
import { Icon } from './Icon';

/** One todo in the list: the checkbox toggles it, the rest of the row opens its details. */
export function TodoRow({ todo, onToggle, onOpen }: { todo: Todo; onToggle: () => void; onOpen: () => void }) {
  const c = useColors();
  return (
    <View testID="todo-row" style={[styles.row, { backgroundColor: c.surface }]}>
      <Checkbox testID="todo-checkbox" checked={todo.done} onToggle={onToggle} label={todo.done ? `Mark "${todo.title}" as open` : `Mark "${todo.title}" as done`} />
      <Pressable
        testID="todo-open"
        accessibilityRole="button"
        accessibilityHint="Opens the details"
        onPress={onOpen}
        style={({ pressed }) => [styles.open, pressed && { backgroundColor: c.surfacePressed }]}
      >
        <View style={styles.texts}>
          <Text
            testID="todo-title"
            numberOfLines={1}
            style={[font.body, { color: todo.done ? c.textMuted : c.text }, todo.done && styles.doneTitle]}
          >
            {todo.title}
          </Text>
          {todo.notes !== '' ? (
            <Text numberOfLines={1} style={[font.caption, { color: c.textMuted }]}>
              {todo.notes}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron-right" color={c.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.xs, minHeight: 64 },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', paddingRight: space.md, gap: space.sm },
  texts: { flex: 1, paddingVertical: space.md },
  doneTitle: { textDecorationLine: 'line-through' },
});
