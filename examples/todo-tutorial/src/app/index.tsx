import { router } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { TodoRow } from '../components/TodoRow';
import { todoStore, useTodos } from '../store';
import { font, radius, space, useColors } from '../theme';

/** The list: every todo, a summary, and the button to the new-todo screen. */
export default function TodoListScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const todos = useTodos();
  const done = todos.filter((t) => t.done).length;

  return (
    <Screen testID="todo-list-screen">
      <FlatList
        data={todos}
        keyExtractor={(t) => t.id}
        contentContainerStyle={[styles.list, todos.length === 0 && styles.emptyList]}
        ListHeaderComponent={
          todos.length > 0 ? (
            <Text testID="todo-summary" style={[font.label, styles.summary, { color: c.textMuted }]}>
              {done} of {todos.length} done
            </Text>
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => (
          <View style={[styles.card, { borderColor: c.border }]}>
            <TodoRow todo={item} onToggle={() => todoStore.toggle(item.id)} onOpen={() => router.push(`/todo/${item.id}`)} />
          </View>
        )}
        ListEmptyComponent={
          <View testID="empty-state" style={styles.empty}>
            <View style={[styles.emptyBadge, { backgroundColor: c.primarySoft }]}>
              <Icon name="check" color={c.primary} size={32} />
            </View>
            <Text accessibilityRole="header" style={[font.title, { color: c.text }]}>
              Nothing to do
            </Text>
            <Text style={[font.body, styles.center, { color: c.textMuted }]}>Add your first todo with the button below.</Text>
          </View>
        }
      />
      <View style={[styles.bar, { borderColor: c.border, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <Button testID="add-todo" label="New todo" icon="plus" onPress={() => router.push('/new')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg },
  emptyList: { flexGrow: 1 },
  summary: { marginBottom: space.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.xl },
  emptyBadge: { width: 64, height: 64, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  center: { textAlign: 'center' },
  bar: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
