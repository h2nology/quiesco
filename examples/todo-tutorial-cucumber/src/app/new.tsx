import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { todoStore } from '../store';
import { type Colors, control, focusRing, radius, space, type, useColors } from '../theme';

/** Stands in for a request to a backend: saving takes a moment. */
const SAVE_DELAY_MS = 600;

function inputStyle(c: Colors, focused: boolean, invalid: boolean) {
  return [
    styles.input,
    type.body,
    {
      color: c.ink,
      backgroundColor: c.surface,
      borderColor: invalid ? c.danger : focused ? c.signal : c.line,
    },
    focusRing(c, focused),
  ];
}

/** The form for a new todo. Saving adds it at the top of the list and goes back there. */
export default function NewTodoScreen() {
  const c = useColors();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focus, setFocus] = useState<'title' | 'notes' | null>(null);

  function save() {
    if (title.trim() === '') {
      setError('Enter a title');
      return;
    }
    setSaving(true);
    setTimeout(() => {
      todoStore.add(title.trim(), notes.trim());
      router.back();
    }, SAVE_DELAY_MS);
  }

  return (
    <Screen testID="new-todo-screen">
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <View style={[styles.panel, { backgroundColor: c.surface, borderColor: c.line }]}>
          <View style={styles.field}>
            <Text nativeID="title-label" style={[type.label, { color: c.ink }]}>
              Title
            </Text>
            <TextInput
              testID="title-input"
              aria-labelledby="title-label"
              accessibilityLabel="Title"
              value={title}
              onChangeText={(text) => {
                setTitle(text);
                setError(null);
              }}
              onFocus={() => setFocus('title')}
              onBlur={() => setFocus(null)}
              placeholder="e.g. Buy milk"
              placeholderTextColor={c.inkMuted}
              autoFocus
              returnKeyType="next"
              editable={!saving}
              style={inputStyle(c, focus === 'title', error !== null)}
            />
            {error !== null ? (
              <Text testID="title-error" accessibilityLiveRegion="polite" role="alert" style={[type.bodySm, { color: c.danger }]}>
                {error}
              </Text>
            ) : null}
          </View>
          <View style={styles.field}>
            <Text nativeID="notes-label" style={[type.label, { color: c.ink }]}>
              Notes <Text style={[type.bodySm, { color: c.inkMuted }]}>(optional)</Text>
            </Text>
            <TextInput
              testID="notes-input"
              aria-labelledby="notes-label"
              accessibilityLabel="Notes"
              value={notes}
              onChangeText={setNotes}
              onFocus={() => setFocus('notes')}
              onBlur={() => setFocus(null)}
              multiline
              editable={!saving}
              style={[inputStyle(c, focus === 'notes', false), styles.notes]}
            />
          </View>
        </View>
        <Button testID="save-todo" label={saving ? 'Saving…' : 'Save'} busy={saving} onPress={save} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { padding: space.lg, gap: space.lg },
  panel: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.xl },
  field: { gap: space.sm },
  input: { minHeight: control, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md },
  notes: { minHeight: 112, textAlignVertical: 'top' },
});
