/**
 * Hidden value-control playground (opened by the `openControls` backdoor), for
 * features/values.feature (Phase 6.3): a slider, a switch, a picker, a segmented control, a date field
 * and an adjustable stepper with accessibility actions. Each control shows its value in a text next to it.
 */
import Slider from '@react-native-community/slider';
import { Picker } from '@react-native-picker/picker';
import SegmentedControlClass from '@react-native-segmented-control/segmented-control';
import type { SegmentedControlProps } from '@react-native-segmented-control/segmented-control';
import { useState } from 'react';
import type { ComponentType } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { AccessibilityActionEvent } from 'react-native';

import { DateField } from '../components/DateField';

import { ScreenTransition } from '../components/ScreenTransition';

export const FRUITS = ['苹果', '香蕉', '樱桃', '榴莲', '葡萄', '芒果', '橙子', '桃子', '梨', '西瓜'] as const;
const SIZES = ['S', 'M', 'L'] as const;
// Its class typings predate React 19's JSX types.
const SegmentedControl = SegmentedControlClass as unknown as ComponentType<SegmentedControlProps>;

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Controls() {
  const [volume, setVolume] = useState(20);
  const [volumeDone, setVolumeDone] = useState('');
  const [notify, setNotify] = useState(false);
  const [fruit, setFruit] = useState<string>('apple');
  const [size, setSize] = useState(0);
  const [birthday, setBirthday] = useState(() => new Date(2026, 0, 15));
  const [stepper, setStepper] = useState(5);
  const [lastAction, setLastAction] = useState('');

  const onAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    setLastAction(name);
    if (name === 'increment') setStepper((n) => n + 1);
    else if (name === 'decrement') setStepper((n) => n - 1);
    else if (name === 'reset') setStepper(0);
  };

  return (
    <ScreenTransition>
      <ScrollView testID="controls" contentContainerStyle={styles.container}>
        <View style={styles.row}>
          <Slider testID="volume" style={styles.slider} minimumValue={0} maximumValue={100} step={1} value={volume} onValueChange={setVolume} onSlidingComplete={(v) => setVolumeDone(String(v))} />
          <Text testID="volume-value">{volume}</Text>
          <Text testID="volume-done">{volumeDone}</Text>
        </View>

        <View style={styles.row}>
          <Switch testID="notify" accessibilityLabel="通知" value={notify} onValueChange={setNotify} />
          <Text testID="notify-value">{notify ? '开' : '关'}</Text>
        </View>

        <View>
          <Picker testID="fruit" selectedValue={fruit} onValueChange={(v) => setFruit(String(v))} style={styles.picker}>
            {FRUITS.map((label, i) => (
              <Picker.Item key={label} label={label} value={i === 0 ? 'apple' : `fruit-${i}`} />
            ))}
          </Picker>
          <Text testID="fruit-value">{fruit}</Text>
        </View>

        <View style={styles.row}>
          {/* segmented-control's JS implementation (Android / web) does not pass testID on: the testID is on a wrapper. */}
          <View testID="size" style={styles.segmented}>
            <SegmentedControl values={[...SIZES]} selectedIndex={size} onChange={(e) => setSize(e.nativeEvent.selectedSegmentIndex)} />
          </View>
          <Text testID="size-value">{SIZES[size]}</Text>
        </View>

        <View>
          <DateField testID="birthday" value={birthday} onChange={setBirthday} />
          <Text testID="birthday-value">{isoDate(birthday)}</Text>
        </View>

        <View style={styles.row}>
          <View
            testID="stepper"
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="数量"
            accessibilityValue={{ now: stepper }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }, { name: 'reset', label: '重置' }]}
            onAccessibilityAction={onAction}
            style={styles.stepper}
          >
            <Text>数量 {stepper}</Text>
          </View>
          <Text testID="stepper-last">{lastAction}</Text>
        </View>
      </ScrollView>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, backgroundColor: 'white' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  slider: { flex: 1, height: 40 },
  picker: { alignSelf: 'stretch' },
  segmented: { flex: 1 },
  stepper: { paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#e5e7eb', borderRadius: 6 },
});
