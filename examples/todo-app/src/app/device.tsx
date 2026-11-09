/**
 * Hidden device-state page (opened by the `openDevice` backdoor), for features/device.feature (Phase 6.6):
 * what the app sees of orientation, color scheme, text size, language, location and its permission.
 */
import * as Location from 'expo-location';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';

import { ScreenTransition } from '../components/ScreenTransition';

export default function Device() {
  const { width, height, fontScale } = useWindowDimensions();
  const scheme = useColorScheme();
  const [position, setPosition] = useState('');
  const dark = scheme === 'dark';

  const readLocation = async () => {
    setPosition('…');
    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) {
      setPosition('无权限');
      return;
    }
    // High accuracy uses GPS, which the emulator's `geo fix` feeds (Balanced needs network location, off on a
    // fresh emulator). Without mayShowUserSettingsDialog: false, Google Play services may open its
    // "Location Accuracy" system dialog over the app.
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: false });
    setPosition(`${p.coords.latitude.toFixed(2)},${p.coords.longitude.toFixed(2)}`);
  };

  const row = (label: string, testID: string, value: string) => (
    <View style={styles.row}>
      <Text style={[styles.label, dark && styles.darkText]}>{label}</Text>
      <Text testID={testID} style={dark && styles.darkText}>
        {value}
      </Text>
    </View>
  );

  return (
    <ScreenTransition>
      <View testID="device" style={[styles.container, dark && styles.dark]}>
        {row('方向', 'orientation', width > height ? 'landscape' : 'portrait')}
        {row('窗口', 'window-size', `${Math.round(width)}x${Math.round(height)}`)}
        {row('外观', 'color-scheme', scheme ?? 'unknown')}
        {row('字号倍数', 'font-scale', fontScale.toFixed(3))}
        {row('语言', 'locale', Intl.DateTimeFormat().resolvedOptions().locale)}
        <View style={styles.row}>
          <Pressable testID="read-location" style={styles.button} onPress={() => void readLocation()}>
            <Text>读取位置</Text>
          </Pressable>
          <Text testID="position" style={dark && styles.darkText}>
            {position}
          </Text>
        </View>
      </View>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  dark: { backgroundColor: '#111' },
  darkText: { color: '#eee' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  label: { fontWeight: '600', width: 72 },
  button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, backgroundColor: '#e8eefc' },
});
