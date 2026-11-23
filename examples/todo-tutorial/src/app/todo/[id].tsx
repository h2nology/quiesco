import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { todoStore, useTodo } from '../../store';
import { font, radius, space, useColors } from '../../theme';

/** One todo: its notes, and the buttons to mark it done or delete it. */
export default function TodoDetailScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const todo = useTodo(id);

  if (todo === undefined) {
    return (
      <Screen testID="todo-detail-screen">
        <View style={styles.missing}>
          <Text style={[font.body, { color: c.textMuted }]}>This todo no longer exists.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen testID="todo-detail-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View
            testID="todo-status"
            style={[styles.pill, { backgroundColor: todo.done ? c.primarySoft : c.background, borderColor: todo.done ? c.primarySoft : c.border }]}
          >
            <Text style={[font.label, { color: todo.done ? c.primary : c.textMuted }]}>{todo.done ? 'Done' : 'Open'}</Text>
          </View>
          <Text testID="detail-title" accessibilityRole="header" style={[font.title, { color: c.text }]}>
            {todo.title}
          </Text>
          <Text testID="detail-notes" style={[font.body, { color: todo.notes !== '' ? c.text : c.textMuted }]}>
            {todo.notes !== '' ? todo.notes : 'No notes'}
          </Text>
        </View>
        <View style={styles.actions}>
          <Button
            testID="toggle-done"
            variant="secondary"
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
  content: { padding: space.lg, gap: space.xl },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.xl, gap: space.md },
  pill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  actions: { gap: space.md },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
});
