/**
 * Hidden capability index (opened by the `openShowcase` backdoor), for features/showcase.feature
 * (Phase 6.11): one entry per hidden test page, so the whole feature set can be walked from one place.
 * Each page keeps its own backdoor and feature; this page does not duplicate them.
 */
import { router } from 'expo-router';
import type { Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { ScreenTransition } from '../components/ScreenTransition';

export const SHOWCASE_PAGES: { id: string; href: Href; title: string; covers: string }[] = [
  { id: 'playground', href: '/playground', title: '动作', covers: '点击位置、连击、按键、拖拽、长列表' },
  { id: 'reorder', href: '/reorder', title: '拖拽排序', covers: '长按后拖动列表行' },
  { id: 'controls', href: '/controls', title: '值控件', covers: '滑块、开关、选择器、日期、无障碍动作' },
  { id: 'gestures', href: '/gestures', title: '多指手势', covers: '捏合、旋转、双指滑动、可缩放视图' },
  { id: 'lifecycle', href: '/lifecycle', title: '生命周期', covers: '启动参数、深链接、前后台、运行时同步开关' },
  { id: 'device', href: '/device', title: '设备状态', covers: '横屏布局、深色、字号、语言、定位、离线、剪贴板' },
  { id: 'system', href: '/system', title: '系统集成', covers: '通知、生物识别、系统弹窗、权限' },
  { id: 'webview', href: '/webview', title: 'WebView', covers: '网页内查找、输入、点击' },
];

export default function Showcase() {
  return (
    <ScreenTransition>
      <ScrollView testID="showcase" contentContainerStyle={styles.container}>
        {SHOWCASE_PAGES.map((p) => (
          <Pressable key={p.id} testID={`showcase-${p.id}`} accessibilityRole="link" style={styles.entry} onPress={() => router.push(p.href)}>
            <Text style={styles.title}>{p.title}</Text>
            <Text style={styles.covers}>{p.covers}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8, backgroundColor: 'white' },
  entry: { padding: 12, borderRadius: 8, backgroundColor: '#f3f4f6', gap: 4 },
  title: { fontWeight: '600' },
  covers: { color: '#4b5563', fontSize: 12 },
});
