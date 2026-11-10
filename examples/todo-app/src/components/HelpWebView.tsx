/** iOS / Android: react-native-webview showing HELP_HTML. The web build uses an iframe (HelpWebView.web.tsx). */
import { WebView } from 'react-native-webview';

import { HELP_HTML } from './help-html';

// WebView's typings default its extra props to `undefined`, which leaves no props at all: name them.
export function HelpWebView({ testID }: { testID: string }) {
  return <WebView<object> testID={testID} originWhitelist={['*']} source={{ html: HELP_HTML }} style={{ flex: 1 }} />;
}
