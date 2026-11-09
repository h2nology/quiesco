/**
 * Hidden app-lifecycle page (opened by the `openLifecycle` backdoor, or the deep link
 * `quiescotodo://lifecycle`), for features/lifecycle.feature (Phase 6.5):
 * - the launch arguments the test passed (`quiesco.launchArgs()`),
 * - a counter kept in AsyncStorage (survives a relaunch unless the data is cleared),
 * - the AppState changes seen while the page is open (background / foreground),
 * - a poller that keeps the app busy until stopped (runtime sync switches),
 * - a solid red box (element screenshots).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { quiesco } from '@quiesco/agent';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenTransition } from '../components/ScreenTransition';

const VISITS_KEY = 'lifecycle.visits';
/** Short enough that the timer tracker always sees one pending (threshold 1.5 s), and the text changes. */
const POLL_MS = 200;

export default function Lifecycle() {
  const [visits, setVisits] = useState<number | null>(null);
  const [states, setStates] = useState<string[]>([AppState.currentState ?? 'unknown']);
  const [polls, setPolls] = useState(0);
  const [polling, setPolling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(VISITS_KEY).then((v) => setVisits(v === null ? 0 : Number(v)));
    const sub = AppState.addEventListener('change', (s) => setStates((prev) => [...prev, s]));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!polling) return undefined;
    const tick = () => {
      setPolls((n) => n + 1);
      timer.current = setTimeout(tick, POLL_MS);
    };
    timer.current = setTimeout(tick, POLL_MS);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [polling]);

  const addVisit = async () => {
    const next = (visits ?? 0) + 1;
    await AsyncStorage.setItem(VISITS_KEY, String(next));
    setVisits(next);
  };

  return (
    <ScreenTransition>
      <View testID="lifecycle" style={styles.container}>
        <Text style={styles.label}>启动参数</Text>
        <Text testID="launch-args">{JSON.stringify(quiesco.launchArgs())}</Text>

        <View style={styles.row}>
          <Text testID="visits">{visits === null ? '…' : String(visits)}</Text>
          <Pressable testID="add-visit" style={styles.button} onPress={() => void addVisit()}>
            <Text>访问 +1</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>App 状态</Text>
        <Text testID="app-states">{states.join(' → ')}</Text>

        <View style={styles.row}>
          <Text testID="poll-count">{polls}</Text>
          <Pressable testID="toggle-poll" style={styles.button} onPress={() => setPolling((p) => !p)}>
            <Text>{polling ? '停止轮询' : '开始轮询'}</Text>
          </Pressable>
        </View>

        <View testID="red-box" style={styles.box} />
      </View>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  label: { fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, backgroundColor: '#e8eefc' },
  box: { width: 80, height: 50, backgroundColor: '#ff0000' },
});
