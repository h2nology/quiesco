import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { StatusDot } from '../components/StatusDot';
import { TodoRow } from '../components/TodoRow';
import { todoStore, useTodos } from '../store';
import { radius, space, type, useColors } from '../theme';

/** The list: a summary with a progress bar, every todo, and the button to the new-todo screen. */
export default function TodoListScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const todos = useTodos();
  const done = todos.filter((t) => t.done).length;

  return (
    <Screen testID="todo-list-screen">
      {todos.length === 0 ? (
        <View testID="empty-state" style={styles.empty}>
          <StatusDot color={c.signal} size={12} />
          <Text accessibilityRole="header" style={[type.section, styles.emptyTitle, { color: c.ink }]}>
            Nothing to do
          </Text>
          <Text style={[type.bodySm, styles.center, { color: c.inkMuted }]}>Add your first todo with the button below.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summary}>
            <Text testID="todo-summary" style={[type.labelSm, { color: c.inkMuted }]}>
              {done} of {todos.length} done
            </Text>
            <View style={[styles.track, { backgroundColor: c.line }]}>
              <View style={[styles.fill, { backgroundColor: c.primary, width: `${(done / todos.length) * 100}%` }]} />
            </View>
          </View>
          <View style={[styles.panel, { backgroundColor: c.surface, borderColor: c.line }]}>
            {todos.map((todo) => (
              <TodoRow key={todo.id} todo={todo} onToggle={() => todoStore.toggle(todo.id)} onOpen={() => router.push(`/todo/${todo.id}`)} />
            ))}
          </View>
        </ScrollView>
      )}
      <View style={[styles.bar, { backgroundColor: c.surface, borderColor: c.line, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <Button testID="add-todo" label="New todo" icon="plus" onPress={() => router.push('/new')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xs },
  track: { flex: 1, height: 4, borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: 4, borderRadius: radius.full },
  panel: { borderWidth: 1, borderRadius: radius.lg, padding: space.xs },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.xl },
  emptyTitle: { marginTop: space.md },
  center: { textAlign: 'center' },
  bar: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: 1 },
});
