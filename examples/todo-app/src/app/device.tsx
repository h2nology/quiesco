/**
 * Hidden device-state page (opened by the `openDevice` backdoor), for features/device.feature (Phase 6.6):
 * what the app sees of orientation, color scheme, text size, language, location and its permission, the
 * network (NetInfo and a request to the mock backend) and the clipboard. Phase 6.10: a response whose body
 * arrives late through `expo/fetch` imported directly, and a WebSocket with a slow handshake — the steps
 * read the result once, without retrying, so they pass only if Quiesco waited for both.
 */
import { useNetInfo } from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import { fetch as expoFetch } from 'expo/fetch';
import * as Location from 'expo-location';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';

import { BASE, api } from '../api';
import { ScreenTransition } from '../components/ScreenTransition';

/** What the "复制" button puts on the clipboard. */
export const COPIED_TEXT = '来自 App 的文字';

export default function Device() {
  const { width, height, fontScale } = useWindowDimensions();
  const scheme = useColorScheme();
  const [position, setPosition] = useState('');
  const [request, setRequest] = useState('');
  const [clipboard, setClipboard] = useState('');
  const [slowBody, setSlowBody] = useState('');
  const [socket, setSocket] = useState('');
  const net = useNetInfo();
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

  const sendRequest = async () => {
    setRequest('…');
    try {
      await api.listTodos();
      setRequest('成功');
    } catch {
      setRequest('失败');
    }
  };

  const loadSlowBody = async () => {
    setSlowBody('…');
    try {
      const res = await expoFetch(`${BASE}/slow-body`);
      const { items } = (await res.json()) as { items: number[] };
      setSlowBody(`${items.length} 条`);
    } catch {
      setSlowBody('失败');
    }
  };

  const connectSocket = () => {
    setSocket('…');
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`);
    ws.onopen = () => {
      setSocket('已连接');
      ws.close();
    };
    ws.onerror = () => setSocket('失败');
  };

  const button = (testID: string, title: string, onPress: () => void) => (
    <Pressable testID={testID} style={styles.button} onPress={onPress}>
      <Text>{title}</Text>
    </Pressable>
  );

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
          {button('read-location', '读取位置', () => void readLocation())}
          <Text testID="position" style={dark && styles.darkText}>
            {position}
          </Text>
        </View>
        {row('网络', 'net-state', net.isConnected === null ? 'unknown' : net.isConnected ? 'online' : 'offline')}
        <View style={styles.row}>
          {button('send-request', '发送请求', () => void sendRequest())}
          <Text testID="request-result" style={dark && styles.darkText}>
            {request}
          </Text>
        </View>
        <View style={styles.row}>
          {button('load-slow-body', '慢响应体', () => void loadSlowBody())}
          <Text testID="slow-body-result" style={dark && styles.darkText}>
            {slowBody}
          </Text>
        </View>
        <View style={styles.row}>
          {button('connect-socket', '连接 WebSocket', connectSocket)}
          <Text testID="socket-result" style={dark && styles.darkText}>
            {socket}
          </Text>
        </View>
        <View style={styles.row}>
          {button('read-clipboard', '读取剪贴板', () => void Clipboard.getStringAsync().then(setClipboard))}
          {button('copy-text', '复制', () => void Clipboard.setStringAsync(COPIED_TEXT).then(() => setClipboard('已复制')))}
          <Text testID="clipboard-text" style={dark && styles.darkText}>
            {clipboard}
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
