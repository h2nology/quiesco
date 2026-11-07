import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, View } from 'react-native';

import { api } from '../api';
import { Button } from '../components/Button';
import { ScreenTransition } from '../components/ScreenTransition';
import { store, useStore } from '../store';

export default function Todos() {
  const session = useStore((s) => s.session);
  const todos = useStore((s) => s.todos);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (session !== null) void api.listTodos().then(store.setTodos);
  }, [session]);

  if (session === null) return <Redirect href="/" />;

  const clearAll = async () => {
    store.setTodos(await api.replaceTodos([]));
    setConfirmClear(false);
  };

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
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button testID="add-todo" title="新建" onPress={() => router.push('/new-todo')} />
          </View>
          <View style={styles.action}>
            <Button testID="clear-todos" title="清空" onPress={() => setConfirmClear(true)} disabled={todos.length === 0} />
          </View>
        </View>
        {/* RN Modal: a separate Android window (native touch injection must reach it). */}
        <Modal visible={confirmClear} transparent animationType="fade" onRequestClose={() => setConfirmClear(false)}>
          <View style={styles.backdrop}>
            <View style={styles.dialog} testID="clear-dialog">
              <Text style={styles.dialogTitle}>确定清空全部待办？</Text>
              <Button testID="confirm-clear" title="确定" onPress={() => void clearAll()} />
              <Button testID="cancel-clear" title="取消" onPress={() => setConfirmClear(false)} />
            </View>
          </View>
        </Modal>
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
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 32 },
  dialog: { backgroundColor: 'white', borderRadius: 12, padding: 20, gap: 12 },
  dialogTitle: { fontSize: 16, fontWeight: '600' },
});
