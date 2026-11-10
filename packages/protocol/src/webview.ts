/**
 * WebView pages (Phase 6.8): the script Quiesco installs in a WebView's pages to know when they are busy.
 * The agent registers it to run at document start of every later load (native WebViews) and the host's
 * page-state script runs it in the current page too; it is idempotent.
 *
 * It counts the page's fetch / XMLHttpRequest calls still running in `window.__quiescoPending`.
 */
export const WEBVIEW_HOOK = `(function () {
  if (window.__quiescoHook) return;
  window.__quiescoHook = true;
  window.__quiescoPending = 0;
  var done = function () { window.__quiescoPending = Math.max(0, window.__quiescoPending - 1); };
  if (typeof window.fetch === 'function') {
    var f = window.fetch;
    window.fetch = function () {
      window.__quiescoPending++;
      var p;
      try { p = f.apply(this, arguments); } catch (e) { done(); throw e; }
      return p.then(function (r) { done(); return r; }, function (e) { done(); throw e; });
    };
  }
  if (typeof XMLHttpRequest === 'function') {
    var send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      window.__quiescoPending++;
      this.addEventListener('loadend', done);
      try { return send.apply(this, arguments); } catch (e) { done(); throw e; }
    };
  }
})();`;
