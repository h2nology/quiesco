import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView, RectButton } from 'react-native-gesture-handler';

import SpikeTouch from './modules/spike-touch/src/SpikeTouchModule';
import { runS1Report } from './spike/s1-report';

// Phase 0 spike test screen. Each spike adds what it needs here; keep testIDs stable.
export default function App() {
  const [pressCount, setPressCount] = useState(0);
  const [rnghCount, setRnghCount] = useState(0);

  // S1: run the fiber query once after the first commit (passive effect).
  useEffect(() => {
    runS1Report();
  }, []);

  let nativePing: string;
  try {
    nativePing = SpikeTouch.ping();
  } catch (e) {
    nativePing = `unavailable (${String(e)})`;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.container} testID="root-view">
        <Text testID="platform-label">Platform: {Platform.OS}</Text>
        <Text testID="native-ping">Native module: {nativePing}</Text>

        <Pressable
          testID="pressable-button"
          accessibilityRole="button"
          onPress={() => setPressCount((c) => c + 1)}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>Pressable</Text>
        </Pressable>
        <Text testID="pressable-count">Pressable count: {pressCount}</Text>

        <RectButton testID="rngh-button" onPress={() => setRnghCount((c) => c + 1)} style={styles.button}>
          <Text style={styles.buttonText}>RNGH RectButton</Text>
        </RectButton>
        <Text testID="rngh-count">RNGH count: {rnghCount}</Text>

        <StatusBar style="auto" />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', gap: 12 },
  button: { backgroundColor: '#2563eb', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  buttonPressed: { backgroundColor: '#1e3a8a' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
