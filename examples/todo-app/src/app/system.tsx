/**
 * Hidden system-integration page (opened by the `openSystem` backdoor), for features/system.feature
 * (Phase 6.7): biometric authentication (expo-local-authentication), notifications the app received or
 * the user tapped (expo-notifications), the notification permission request and shakes (react-native-shake).
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import RNShake from 'react-native-shake';

import { ScreenTransition } from '../components/ScreenTransition';

// Show notifications that arrive while the app is in front (by default they are not shown).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export default function System() {
  const [enrolled, setEnrolled] = useState('');
  const [auth, setAuth] = useState('');
  const [received, setReceived] = useState('');
  const [tapped, setTapped] = useState('');
  const [shakes, setShakes] = useState(0);
  const [permission, setPermission] = useState('');

  const readEnrollment = async () => {
    const [hardware, isEnrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
    setEnrolled(!hardware ? '无硬件' : isEnrolled ? '已录入' : '未录入');
  };

  const authenticate = async () => {
    setAuth('…');
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Quiesco', disableDeviceFallback: true, cancelLabel: '取消' });
    setAuth(r.success ? '成功' : `失败:${r.error}`);
  };

  useEffect(() => {
    const a = Notifications.addNotificationReceivedListener((n) => setReceived(n.request.content.title ?? ''));
    const b = Notifications.addNotificationResponseReceivedListener((r) => setTapped(r.notification.request.content.title ?? ''));
    const c = RNShake.addListener(() => setShakes((n) => n + 1));
    return () => {
      a.remove();
      b.remove();
      c?.remove();
    };
  }, []);

  const button = (testID: string, title: string, onPress: () => void) => (
    <Pressable testID={testID} style={styles.button} onPress={onPress}>
      <Text>{title}</Text>
    </Pressable>
  );

  return (
    <ScreenTransition>
      <View testID="system" style={styles.container}>
        <View style={styles.row}>
          {button('read-enrollment', '读取录入状态', () => void readEnrollment())}
          <Text testID="enrollment">{enrolled}</Text>
        </View>
        <View style={styles.row}>
          {button('authenticate', '生物识别认证', () => void authenticate())}
          <Text testID="auth-result">{auth}</Text>
        </View>
        <View style={styles.row}>
          {button('read-notification-permission', '读取通知权限', () => void Notifications.getPermissionsAsync().then((p) => setPermission(p.status)))}
          <Text testID="notification-permission">{permission}</Text>
        </View>
        <View style={styles.row}>
          {/* Shows the system's permission dialog while the permission is undetermined (features/system.feature). */}
          {button('request-notification-permission', '请求通知权限', () => void Notifications.requestPermissionsAsync().then((p) => setPermission(p.status)))}
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>收到通知</Text>
          <Text testID="notification-received">{received}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>点击通知</Text>
          <Text testID="notification-tapped">{tapped}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>摇动次数</Text>
          <Text testID="shake-count">{String(shakes)}</Text>
        </View>
      </View>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  label: { fontWeight: '600', width: 72 },
  button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, backgroundColor: '#e8eefc' },
});
