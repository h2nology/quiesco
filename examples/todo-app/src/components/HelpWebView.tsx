/** iOS / Android: react-native-webview showing HELP_HTML. The web build uses an iframe (HelpWebView.web.tsx). */
import { forwardRef } from 'react';
import { WebView } from 'react-native-webview';

import { HELP_HTML } from './help-html';

// WebView's typings default its extra props to `undefined`, which leaves no props at all: name them.
export const HelpWebView = forwardRef<WebView<object>, { testID: string }>(function HelpWebView({ testID }, ref) {
  return <WebView<object> ref={ref} testID={testID} originWhitelist={['*']} source={{ html: HELP_HTML }} style={{ flex: 1 }} />;
});
