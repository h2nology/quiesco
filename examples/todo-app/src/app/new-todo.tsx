import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { api } from '../api';
import { Button } from '../components/Button';
import { ScreenTransition } from '../components/ScreenTransition';
import { store } from '../store';

export default function NewTodo() {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Form-state demo for the Phase 6.1 assertions (focus, disabled → enabled, checked, value): the switch
  // is only usable once there is a title. It is not saved.
  const [important, setImportant] = useState(false);

  const save = async () => {
    if (title.trim() === '') {
      setError('请输入标题');
      return;
    }
    setBusy(true);
    try {
      store.prependTodo(await api.createTodo(title.trim()));
      router.back();
    } catch {
      setError('保存失败');
      setBusy(false);
    }
  };

  return (
    <ScreenTransition>
      <View style={styles.container} testID="new-todo-screen">
        <TextInput testID="todo-title" accessibilityLabel="标题" placeholder="标题" value={title} onChangeText={setTitle} style={styles.input} autoFocus />
        <View style={styles.row}>
          <Text>标记为重要</Text>
          <Switch testID="todo-important" accessibilityLabel="标记为重要" value={important} onValueChange={setImportant} disabled={title.trim() === ''} />
        </View>
        {error !== null && (
          <Text testID="todo-title-error" style={styles.error}>
            {error}
          </Text>
        )}
        {/* Pinned to the bottom, so the software keyboard covers it after typing (Quiesco dismisses it first). */}
        <View style={styles.footer}>
          <Button testID="save-todo" title="保存" onPress={() => void save()} disabled={busy} />
        </View>
      </View>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, backgroundColor: 'white' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12, fontSize: 16 },
  error: { color: '#dc2626' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footer: { marginTop: 'auto', paddingBottom: 24 },
});
