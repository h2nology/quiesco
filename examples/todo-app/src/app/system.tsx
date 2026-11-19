/**
 * Hidden system-integration page (opened by the `openSystem` backdoor), for features/system.feature
 * (Phase 6.7): biometric authentication (expo-local-authentication), notifications the app received or
 * the user tapped (expo-notifications), the notification permission request and shakes (react-native-shake);
 * on the web the browser's JS dialogs (alert / confirm). UI that is not React (issues #49–#51): a web login in
 * an auth session, the share sheet, and on iOS an inline date picker (UIKit).
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import RNShake from 'react-native-shake';

import { apiBase } from '../api';
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
  const [dialog, setDialog] = useState('');
  const [picked, setPicked] = useState('');
  const [authResult, setAuthResult] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const noteField = (
    <View style={styles.noteDialog}>
      <TextInput testID="note-input" accessibilityLabel="备注" placeholder="备注" value={note} onChangeText={setNote} style={styles.noteInput} />
      <Pressable accessibilityRole="button" onPress={() => setNoteOpen(false)}>
        <Text>完成</Text>
      </Pressable>
    </View>
  );

  // A web login in an auth session (ASWebAuthenticationSession / Custom Tab): the mock backend's page
  // sends the user back to quiescotodo://auth?user=… (issue #51).
  const signInWeb = async () => {
    const r = await WebBrowser.openAuthSessionAsync(`${apiBase()}/auth`, 'quiescotodo://auth');
    setAuthResult(r.type === 'success' ? `已登录：${new URL(r.url).searchParams.get('user') ?? ''}` : r.type);
  };

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
      <ScrollView testID="system-scroll">
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
            {/* A local notification a few seconds ahead: posted while the app is in the background (issues #64, #65, #68). */}
            {button('schedule-notification', '3 秒后提醒', () =>
              void Notifications.scheduleNotificationAsync({
                content: { title: '稍后提醒', body: '3 秒前预约的通知' },
                trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
              }),
            )}
          </View>
          {Platform.OS === 'web' && (
            <View style={styles.row}>
              {/* The browser's JS dialogs block the page until answered (features/system.feature, @web). */}
              {button('confirm-reset', '清零摇动次数', () => {
                const ok = globalThis.confirm('清零摇动次数?');
                if (ok) setShakes(0);
                setDialog(ok ? '确定' : '取消');
              })}
              {button('show-alert', '显示提示', () => {
                globalThis.alert('已保存');
                setDialog('提示已关闭');
              })}
              <Text testID="dialog-result">{dialog}</Text>
            </View>
          )}
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
          {/* UI that is not React (issues #49–#51): another app's (a web login), the share sheet, UIKit's. */}
          {Platform.OS !== 'web' && (
            <View style={styles.row}>
              {button('sign-in-web', '网页登录', () => void signInWeb())}
              <Text testID="web-auth-result">{authResult}</Text>
              {button('share', '分享', () => void Share.share({ message: 'Quiesco' }))}
            </View>
          )}
          {Platform.OS === 'ios' && (
            <DateTimePicker testID="inline-date" value={new Date(2026, 11, 1)} mode="date" display="inline" onChange={(_e, d) => d && setPicked(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`)} />
          )}
          <Text testID="inline-date-value">{picked}</Text>
          {/*
            The field system.type types into: in a Modal on Android (a dialog window of its own), on the page on
            iOS (a Modal shown again in the same session can be missing from XCUITest's snapshot; app.type reaches it).
          */}
          {Platform.OS !== 'web' && (
            <View style={styles.row}>
              {button('open-note', '输入对话框', () => setNoteOpen(true))}
              <Text testID="note-value">{note}</Text>
            </View>
          )}
          {Platform.OS === 'android' ? (
            <Modal visible={noteOpen} transparent animationType="fade" onRequestClose={() => setNoteOpen(false)}>
              <View style={styles.noteBackdrop}>{noteField}</View>
            </Modal>
          ) : (
            noteOpen && noteField
          )}
        </View>
      </ScrollView>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  noteBackdrop: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  noteDialog: { margin: 24, padding: 16, gap: 12, backgroundColor: 'white', borderRadius: 8 },
  noteInput: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, padding: 8 },
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  label: { fontWeight: '600', width: 72 },
  button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, backgroundColor: '#e8eefc' },
});
