import { Redirect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { api } from '../api';
import { Button } from '../components/Button';
import { store, useStore } from '../store';

export default function Login() {
  const session = useStore((s) => s.session);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const headerHeight = useHeaderHeight();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session !== null) return <Redirect href="/todos" />;

  const login = async () => {
    if (email.trim() === '') {
      setError('请输入邮箱');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await store.setSession(await api.login(email.trim(), password));
    } catch {
      setError('登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: headerHeight + 24 }]} testID="login-screen">
      <TextInput testID="email" accessibilityLabel="邮箱" placeholder="邮箱" autoCapitalize="none" value={email} onChangeText={setEmail} style={styles.input} />
      <TextInput testID="password" accessibilityLabel="密码" placeholder="密码" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} />
      {error !== null && (
        <Text testID="login-error" style={styles.error}>
          {error}
        </Text>
      )}
      <Button testID="login-button" title="登录" onPress={() => void login()} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, backgroundColor: 'white' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12, fontSize: 16 },
  error: { color: '#dc2626' },
});
