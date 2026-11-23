import { QuiescoRoot } from '@quiesco/agent';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { font, useColors } from '../theme';

// Backdoors and the reset hook for the e2e tests: only in builds made with EXPO_PUBLIC_QUIESCO=1.
if (process.env.EXPO_PUBLIC_QUIESCO === '1') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../e2e');
}

export default function RootLayout() {
  const c = useColors();
  return (
    <QuiescoRoot>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.primary,
          headerTitleStyle: { color: c.text, fontSize: 17, fontWeight: font.bodyStrong.fontWeight },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Todos' }} />
        <Stack.Screen name="new" options={{ title: 'New todo' }} />
        <Stack.Screen name="todo/[id]" options={{ title: 'Details' }} />
      </Stack>
    </QuiescoRoot>
  );
}
