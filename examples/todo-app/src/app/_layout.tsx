import { QuiescoRoot } from '@quiesco/agent';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
    // Transparent header on every platform: screens are laid out under it and pad themselves with the
    // header height (useHeaderHeight). iOS 26+ always lays screens out under the bar (react-native-screens),
    // so this keeps the layout the same on iOS, Android and web.
    <Stack screenOptions={{ headerTransparent: true }}>
      <Stack.Screen name="index" options={{ title: '登录' }} />
      <Stack.Screen name="todos" options={{ title: '待办', headerBackVisible: false }} />
      <Stack.Screen name="new-todo" options={{ title: '新建待办' }} />
      {/* iOS 26 pops a screen on a rightward swipe anywhere in its content; the playground's drag box
          moves right, so its back gesture is off (a real user dragging it would leave the screen too). */}
      <Stack.Screen name="playground" options={{ title: '能力演示', gestureEnabled: false }} />
      {/* The slider and the wheels are dragged horizontally / vertically; no back swipe either. */}
      <Stack.Screen name="controls" options={{ title: '值控件', gestureEnabled: false }} />
      <Stack.Screen name="gestures" options={{ title: '多指手势', gestureEnabled: false }} />
      <Stack.Screen name="lifecycle" options={{ title: '生命周期' }} />
      <Stack.Screen name="device" options={{ title: '设备状态' }} />
      <Stack.Screen name="system" options={{ title: '系统集成' }} />
      <Stack.Screen name="showcase" options={{ title: '能力一览' }} />
      {/* Rows are dragged vertically; no back swipe on a page whose content is dragged. */}
      <Stack.Screen name="reorder" options={{ title: '拖拽排序', gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QuiescoRoot>
        <App />
      </QuiescoRoot>
    </GestureHandlerRootView>
  );
}
