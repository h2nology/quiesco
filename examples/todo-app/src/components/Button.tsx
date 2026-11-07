import { Pressable, StyleSheet, Text } from 'react-native';

export function Button({ title, onPress, testID, disabled }: { title: string; onPress: () => void; testID: string; disabled?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dim]}
    >
      <Text style={styles.label}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, alignItems: 'center' },
  dim: { opacity: 0.6 },
  label: { color: 'white', fontSize: 16, fontWeight: '600' },
});
