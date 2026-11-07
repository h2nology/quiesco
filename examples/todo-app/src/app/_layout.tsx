import { QuiescoRoot } from '@quiesco/agent';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';

import { store } from '../store';

if (process.env.EXPO_PUBLIC_QUIESCO === '1') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../e2e');
}

function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void store.restoreSession().finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: '登录' }} />
      <Stack.Screen name="todos" options={{ title: '待办', headerBackVisible: false }} />
      <Stack.Screen name="new-todo" options={{ title: '新建待办' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <QuiescoRoot>
      <App />
    </QuiescoRoot>
  );
}
