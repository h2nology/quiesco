/** Hidden WebView page (opened by the `openWebView` backdoor), for features/webview.feature (Phase 6.8). */
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HelpWebView } from '../components/HelpWebView';
import { ScreenTransition } from '../components/ScreenTransition';

/** SPIKE 6.8: the WebView's ref for the probe backdoor (src/e2e.ts). Removed after the spike. */
export const spikeWebViewRef: { current: unknown } = { current: null };

export default function WebViewPage() {
  const ref = useRef(null);
  const host = useRef(null);
  spikeWebViewRef.current = host;
  return (
    <ScreenTransition>
      <View testID="webview-page" style={styles.container}>
        <Text style={styles.title}>帮助</Text>
        <View ref={host} collapsable={false} style={styles.web}>
          <HelpWebView ref={ref} testID="help" />
        </View>
      </View>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  web: { flex: 1 },
  title: { fontSize: 18, fontWeight: '600', padding: 12 },
});
