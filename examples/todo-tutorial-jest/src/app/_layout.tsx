import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, useFonts } from '@expo-google-fonts/geist';
import { QuiescoRoot } from '@quiesco/agent';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { fonts, useColors } from '../theme';

// Backdoors and the reset hook for the e2e tests: only in builds made with EXPO_PUBLIC_QUIESCO=1.
if (process.env.EXPO_PUBLIC_QUIESCO === '1') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../e2e');
}

function App() {
  const c = useColors();
  const [loaded] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold });
  if (!loaded) return null;
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.canvas },
          headerTintColor: c.accentText,
          headerTitleStyle: { color: c.ink, fontFamily: fonts.semibold, fontSize: 17 },
          headerBackTitleStyle: { fontFamily: fonts.regular },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.canvas },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Todos' }} />
        <Stack.Screen name="new" options={{ title: 'New todo' }} />
        <Stack.Screen name="todo/[id]" options={{ title: 'Details' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <QuiescoRoot>
      <App />
    </QuiescoRoot>
  );
}
