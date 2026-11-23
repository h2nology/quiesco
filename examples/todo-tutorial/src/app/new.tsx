import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { todoStore } from '../store';
import { font, radius, space, touchTarget, useColors } from '../theme';

/** Stands in for a request to a backend: saving takes a moment. */
const SAVE_DELAY_MS = 600;

/** The form for a new todo. Saving adds it at the top of the list and goes back there. */
export default function NewTodoScreen() {
  const c = useColors();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const input = [styles.input, font.body, { color: c.text, backgroundColor: c.inputBackground }];
  return (
    <Screen testID="new-todo-screen">
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <Text nativeID="title-label" style={[font.label, { color: c.text }]}>
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
            placeholder="e.g. Buy milk"
            placeholderTextColor={c.textMuted}
            autoFocus
            returnKeyType="next"
            editable={!saving}
            style={[input, { borderColor: error !== null ? c.danger : c.border }]}
          />
          {error !== null ? (
            <Text testID="title-error" accessibilityLiveRegion="polite" role="alert" style={[font.caption, { color: c.danger }]}>
              {error}
            </Text>
          ) : null}
        </View>
        <View style={styles.field}>
          <Text nativeID="notes-label" style={[font.label, { color: c.text }]}>
            Notes <Text style={{ color: c.textMuted, fontWeight: '400' }}>(optional)</Text>
          </Text>
          <TextInput
            testID="notes-input"
            aria-labelledby="notes-label"
            accessibilityLabel="Notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            editable={!saving}
            style={[input, styles.notes, { borderColor: c.border }]}
          />
        </View>
        <Button testID="save-todo" label={saving ? 'Saving…' : 'Save'} busy={saving} onPress={save} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { padding: space.lg, gap: space.xl },
  field: { gap: space.sm },
  input: { minHeight: touchTarget, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md },
  notes: { minHeight: 112, textAlignVertical: 'top' },
});
