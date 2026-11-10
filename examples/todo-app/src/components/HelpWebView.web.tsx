/** Web: react-native-webview has no web implementation; the same page in an iframe. */
import { HELP_HTML } from './help-html';

export function HelpWebView({ testID }: { testID: string }) {
  return <iframe data-testid={testID} title="帮助" srcDoc={HELP_HTML} style={{ flex: 1, border: 0, width: '100%', height: '100%' }} />;
}
