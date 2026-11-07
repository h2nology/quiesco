import { Redirect, router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { api } from '../api';
import { Button } from '../components/Button';
import { ScreenTransition } from '../components/ScreenTransition';
import { store, useStore } from '../store';

export default function Todos() {
  const session = useStore((s) => s.session);
  const todos = useStore((s) => s.todos);

  useEffect(() => {
    if (session !== null) void api.listTodos().then(store.setTodos);
  }, [session]);

  if (session === null) return <Redirect href="/" />;

  return (
    <ScreenTransition>
      <View style={styles.container} testID="todos-screen">
        <Text testID="greeting" style={styles.greeting}>
          {session.email}
        </Text>
        <FlatList
          testID="todo-list"
          data={todos}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => (
            <View testID="todo-item" style={styles.item}>
              <Text style={styles.title}>{item.title}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text testID="todo-empty" style={styles.empty}>
              还没有待办
            </Text>
          }
        />
        <Button testID="add-todo" title="新建" onPress={() => router.push('/new-todo')} />
      </View>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: 'white' },
  greeting: { color: '#6b7280' },
  item: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  title: { fontSize: 16 },
  empty: { color: '#9ca3af', textAlign: 'center', marginTop: 32 },
});
