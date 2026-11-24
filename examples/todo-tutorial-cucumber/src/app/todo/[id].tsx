import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { StatusDot } from '../../components/StatusDot';
import { todoStore, useTodo } from '../../store';
import { radius, space, type, useColors } from '../../theme';

/** One todo: its state, its notes, and the buttons to mark it done or delete it. */
export default function TodoDetailScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const todo = useTodo(id);

  if (todo === undefined) {
    return (
      <Screen testID="todo-detail-screen">
        <View style={styles.missing}>
          <Text style={[type.body, { color: c.inkMuted }]}>This todo no longer exists.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen testID="todo-detail-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.panel, { backgroundColor: c.surface, borderColor: c.line }]}>
          {/* A status pill: the dot plus a label. Open uses the brand blue, done steps back to muted ink. */}
          <View testID="todo-status" style={[styles.pill, { backgroundColor: todo.done ? c.surfaceSunken : c.accentSoft }]}>
            <StatusDot color={todo.done ? c.inkMuted : c.accentText} />
            <Text style={[type.labelSm, { color: todo.done ? c.inkMuted : c.accentText }]}>{todo.done ? 'Done' : 'Open'}</Text>
          </View>
          <Text testID="detail-title" accessibilityRole="header" style={[type.section, { color: c.ink }, todo.done && styles.doneTitle]}>
            {todo.title}
          </Text>
          <View style={[styles.divider, { backgroundColor: c.line }]} />
          <Text testID="detail-notes" style={[type.body, { color: todo.notes !== '' ? c.ink : c.inkMuted }]}>
            {todo.notes !== '' ? todo.notes : 'No notes'}
          </Text>
        </View>
        <View style={styles.actions}>
          <Button
            testID="toggle-done"
            variant={todo.done ? 'secondary' : 'primary'}
            icon={todo.done ? undefined : 'check'}
            label={todo.done ? 'Mark as open' : 'Mark as done'}
            onPress={() => todoStore.toggle(todo.id)}
          />
          <Button
            testID="delete-todo"
            variant="danger"
            label="Delete todo"
            onPress={() => {
              todoStore.remove(todo.id);
              router.back();
            }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg },
  panel: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm - 2,
    borderRadius: radius.full,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs,
  },
  divider: { height: 1 },
  doneTitle: { textDecorationLine: 'line-through' },
  actions: { gap: space.md },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
});
