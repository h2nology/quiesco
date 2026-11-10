/** Web: react-native-webview has no web implementation; the same page in an iframe. */
import { forwardRef } from 'react';

import { HELP_HTML } from './help-html';

export const HelpWebView = forwardRef<HTMLIFrameElement, { testID: string }>(function HelpWebView({ testID }, ref) {
  return <iframe ref={ref} data-testid={testID} title="帮助" srcDoc={HELP_HTML} style={{ flex: 1, border: 0, width: '100%', height: '100%' }} />;
});
