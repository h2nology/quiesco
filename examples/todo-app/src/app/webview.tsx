/** Hidden WebView page (opened by the `openWebView` backdoor), for features/webview.feature (Phase 6.8). */
import { StyleSheet, Text, View } from 'react-native';

import { HelpWebView } from '../components/HelpWebView';
import { ScreenTransition } from '../components/ScreenTransition';

export default function WebViewPage() {
  return (
    <ScreenTransition>
      <View testID="webview-page" style={styles.container}>
        <Text style={styles.title}>帮助</Text>
        <HelpWebView testID="help" />
      </View>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  title: { fontSize: 18, fontWeight: '600', padding: 12 },
});
