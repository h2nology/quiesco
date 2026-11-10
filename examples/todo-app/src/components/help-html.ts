/**
 * The page shown in the WebView page (src/app/webview.tsx): a small form, a delayed greeting fetched over
 * the network (WebView synchronization) and a link to a second page.
 */
export const HELP_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>帮助</title>
<style>body{font-family:sans-serif;margin:16px} button,input{font-size:18px;padding:8px;margin:4px 0} #spacer{height:900px}</style>
</head><body>
<h1 id="heading">帮助中心</h1>
<label>名字 <input id="name" name="name" placeholder="你的名字"></label><br>
<button id="greet" type="button">打招呼</button>
<p id="result"></p>
<button id="slow" type="button">稍后问候</button>
<p id="slow-result"></p>
<a id="faq" href="#faq">常见问题</a>
<div id="spacer"></div>
<p id="bottom">到底了</p>
<script>
  document.getElementById('greet').addEventListener('click', function () {
    document.getElementById('result').textContent = '你好，' + document.getElementById('name').value;
  });
  // A request and a timer before the text changes: the WebView must count as busy meanwhile.
  document.getElementById('slow').addEventListener('click', function () {
    fetch('http://localhost:8083/status', { mode: 'no-cors' }).catch(function () {}).then(function () {
      setTimeout(function () { document.getElementById('slow-result').textContent = '晚上好'; }, 700);
    });
  });
  // A fragment link resolves against the parent page in a srcdoc iframe (web): move the hash by script.
  document.getElementById('faq').addEventListener('click', function (e) { e.preventDefault(); location.hash = 'faq'; });
  window.addEventListener('hashchange', function () { document.title = '帮助 ' + location.hash; });
</script>
</body></html>`;
