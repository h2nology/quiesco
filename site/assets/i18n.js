// Tiny i18n layer shared by every page.
// Static text: elements carry data-i18n="key"; their English markup in the HTML is the source,
// and zh / ja come from STATIC below. Dynamic text rendered by scripts uses t(key, vars) with DYN.
// Attributes: data-i18n-attr="content:key;aria-label:key2".
(function () {
  const SUPPORTED = ['en', 'zh', 'ja'];

  const STATIC = {
    zh: {
      /* shared */
      'nav.benchmark': '性能对比', 'nav.how': '工作原理', 'nav.docs': '文档', 'nav.github': 'GitHub', 'nav.start': '开始使用',
      'ui.copy': '复制', 'ui.home': '首页',
      'foot.tag': 'Quiesco 源自拉丁语 <em>quiēscō</em>，意为“归于静止”。',
      /* home */
      'home.title': 'Quiesco — 等应用静下来，再测试',
      'home.desc': '面向 Expo 应用的灰盒端到端测试，支持 iOS、Android 和 Web。在 160 次运行的对比测试中，Quiesco 跑完同一套测试比第二快的工具少用 38% 的时间。',
      'hero.anno': 'Expo 应用的 E2E 测试 · iOS · Android · Web',
      'hero.h1a': 'E2E 测试，', 'hero.h1b': '本该这么快，这么稳。',
      'hero.lead': 'Expo 应用一空闲，Quiesco 就立刻执行下一步。不用 sleep()，不用轮询，也不用猜。',
      'bench.eyebrow': '<b>01</b> / 性能对比',
      'bench.h2': '同一个应用，同样 22 个场景，四种工具。',
      'bench.lead': '用 Quiesco、Appium、Detox 和 Maestro 对同一个 Expo SDK 58 Release 构建做端到端测试。每个工具在每个平台交错运行 20 次，宿主机为 Apple M5 Pro。对比基于整套耗时中位数，包含重置时间。',
      'bench.more': '逐场景数据与测量方法',
      'bench.cap': '整套耗时中位数，Quiesco 对比各工具',
      'bench.code': '查看测试代码',
      'how.eyebrow': '<b>02</b> / 工作原理',
      'how.h2': '快，是因为从不靠猜。',
      'how.lead': '黑盒工具看不到应用内部，只能 sleep 固定时间，或者反复轮询屏幕直到某个元素出现。Quiesco 运行在 e2e 构建内部，追踪每一个工作来源。最后一个一结束，下一步立刻执行。',
      'how.tl.ex': '举个例子：测试点了<b>保存</b>之后，应用要忙 1.2 秒，发请求、重新渲染。下一步应该什么时候执行？',
      'how.tl.app': '应用', 'how.tl.app.n': '1.45 秒时空闲', 'how.tl.busy': '请求 + 渲染', 'how.tl.idle': '空闲', 'how.tl.next': '下一步',
      'how.tl.sleep': '固定 sleep', 'how.tl.sleep.n': '白等 1.8 秒',
      'how.tl.poll': '轮询屏幕', 'how.tl.poll.n': '早了 0.35 秒，可能失败',
      'how.tl.q.n': '正好在空闲时执行下一步', 'how.tl.others': '其他工具的等法',
      'how.tl.foot': '轮询每 0.3 秒看一次屏幕，按钮一出现就动手，哪怕应用还在忙。Quiesco 等的是工作本身结束。',
      'feat.eyebrow': '<b>03</b> / 功能',
      'feat.h2': '测试需要的都有，生产环境里什么都不留。',
      'feat.1.t': '自动同步', 'feat.1.d': '网络、计时器、React 调度器、idle 回调、原生转场，以及帧稳定兜底。同步超时会指出还在忙的是什么。',
      'feat.2.t': '真实输入，覆盖所有平台', 'feat.2.d': 'iOS 和 Android 通过 <code>@quiesco/native</code> 发送触摸和文字，Web 用 Playwright。同一份测试不改一行就能在三端运行。',
      'feat.3.t': '约 200 ms 的重置', 'feat.3.d': '每个测试前做一次软重置（存储、你的重置钩子、重新挂载）。真需要重启应用时，给测试打上 <code>@hard-reset</code> 标签。',
      'feat.4.t': '后门', 'feat.4.d': '不经过 UI，直接从测试里准备状态：<code>app.backdoor(\'loginAs\', …)</code>。登录一次，专心测重要的部分。',
      'feat.5.t': '测试 UI 与实时进度', 'feat.5.d': '<code>quiesco ui</code> 在浏览器里运行测试，每个失败都附带截图和元素树。CLI 在最后一行显示进度条。',
      'feat.6.t': '不进生产环境', 'feat.6.d': '没有 <code>EXPO_PUBLIC_QUIESCO=1</code> 时，agent 会被替换成空实现，原生模块也不会打进构建。CI 会检查这一点。',
      'qs.eyebrow': '<b>04</b> / 快速开始',
      'qs.h2': '大约十分钟写出第一个测试。',
      'qs.lead': '准备一个 Expo SDK 55 及以上的应用和 Node.js 24。',
      'qs.1.t': '运行 <code>npx quiesco init</code>', 'qs.1.d': '安装依赖、config plugin、Metro 配置、<code>quiesco.config.mts</code> 和第一个测试。',
      'qs.2.t': '用 <code>&lt;QuiescoRoot&gt;</code> 包住根布局', 'qs.2.d': '一个组件，只在 e2e 构建里启用 agent。',
      'qs.3.t': '运行 <code>npx quiesco test</code>', 'qs.3.d': '在 Chromium、iOS 模拟器或 Android 模拟器上运行。',
      'qs.any': '任意 Node.js 测试运行器',
      'qs.c1': '// 不经过 UI 准备状态', 'qs.c2': '// 每一步都等应用空闲后执行',
      'close.h2': '快和稳，不必二选一。',
      'close.lead': '开源，MIT 许可证，npm 包名为 <code>quiesco</code>。',
      'close.bench': '查看性能对比',
      /* benchmark page */
      'bp.title': 'Quiesco 性能对比',
      'bp.desc': 'Quiesco、Appium、Detox、Maestro 在 iOS 和 Android 上的逐场景耗时、失败率与测试环境。',
      'bp.anno': '会话 m5-final-none · 测量于 2026-11-24 → 26（JST）',
      'bp.h1': '四种 E2E 工具。<br>一个 Expo 应用。160 次运行。',
      'bp.lead': 'Quiesco、Appium、Detox 和 Maestro 各自对同一个 Expo SDK 58 Release 构建运行同一套 24 个场景，每个平台 20 次，交错执行，宿主机是同一台 Apple M5 Pro。下面是原始结果：中位数、波动、失败，以及每个工具赢在哪里。',
      'bp.toc.suite': '整套结果', 'bp.toc.find': '先读这里', 'bp.toc.sc': '逐场景', 'bp.toc.env': '测试环境', 'bp.toc.method': '测量方法',
      'bp.suite.eyebrow': '<b>01</b> / 整套结果', 'bp.suite.h2': '共同场景集的整套耗时',
      'bp.suite.lead': '单位为秒，包含重置。共同场景集是该平台上每个工具都能运行的 22 个场景：iOS 去掉 S21 和 S22，Android 去掉 S10b 和 S22。',
      'bp.suite.note': 'Detox 在 Android 上有 1 次 S23 失败，其整套耗时按其余 19 次计算。Detox 在 iOS 上每次都因 S21 失败，但 S21 不在共同场景集内，所以仍有整套耗时。安装、启动为中位数（秒）。',
      'th.tool': '工具', 'th.median': '中位数', 'th.vsq': '对比 Quiesco', 'th.p90': 'p90', 'th.range': '最快 – 最慢', 'th.fails': '整套失败',
      'th.rate': '失败率（95% 区间）', 'th.install': '安装', 'th.launch': '启动',
      'bp.find.eyebrow': '<b>02</b> / 先读这里', 'bp.find.h2': '这些数字说明了什么，没说明什么',
      'bp.sc.eyebrow': '<b>03</b> / 逐场景', 'bp.sc.h2': '每个场景，每个工具',
      'bp.sc.lead': '通过的运行的耗时中位数（秒），不含重置。横轴为对数刻度，所有场景共用。点击一行查看 p90、波动、失败率、重置时间和报错。',
      'bp.env.eyebrow': '<b>04</b> / 测试环境', 'bp.env.h2': '测试环境',
      'bp.method.eyebrow': '<b>05</b> / 测量方法', 'bp.method.h2': '怎样读这些数据',
    },
    ja: {
      'nav.benchmark': 'ベンチマーク', 'nav.how': 'しくみ', 'nav.docs': 'ドキュメント', 'nav.github': 'GitHub', 'nav.start': 'はじめる',
      'ui.copy': 'コピー', 'ui.home': 'ホーム',
      'foot.tag': 'Quiesco はラテン語の <em>quiēscō</em>（「静まる」）に由来します。',
      'home.title': 'Quiesco — アプリが静まってからテストする',
      'home.desc': 'Expo アプリ向けのグレーボックス E2E テスト。iOS・Android・Web に対応。160 回の比較測定で、同じスイートを次に速いツールより 38% 短い時間で完走しました。',
      'hero.anno': 'Expo アプリの E2E テスト · iOS · Android · Web',
      'hero.h1a': 'E2E テストは、', 'hero.h1b': 'こんなに速く、安定できる。',
      'hero.lead': 'Expo アプリがアイドルになった瞬間に、Quiesco は次のステップを実行します。sleep() もポーリングも、当て推量も要りません。',
      'bench.eyebrow': '<b>01</b> / ベンチマーク',
      'bench.h2': '同じアプリ、同じ 22 シナリオ、4 つのツール。',
      'bench.lead': '同じ Expo SDK 58 のリリースビルドを Quiesco、Appium、Detox、Maestro で E2E テストしました。ツールとプラットフォームごとに 20 回ずつ交互に実行し、ホストは Apple M5 Pro です。スイート全体の所要時間の中央値で、リセット時間を含みます。',
      'bench.more': 'シナリオ別データと測定方法',
      'bench.cap': 'スイート全体の所要時間（中央値）、Quiesco と各ツールの比較',
      'bench.code': 'テストコードを見る',
      'how.eyebrow': '<b>02</b> / しくみ',
      'how.h2': '速いのは、推測しないから。',
      'how.lead': 'ブラックボックスのツールはアプリの中が見えないので、決まった時間 sleep するか、要素が現れるまで画面をポーリングするしかありません。Quiesco は e2e ビルドの中で動き、すべての処理の発生源を追跡します。最後のひとつが落ち着いた瞬間に、次のステップを実行します。',
      'how.tl.ex': '例：テストが<b>保存</b>をタップしたあと、アプリはリクエストと再レンダリングで 1.2 秒処理中になります。次のステップはいつ実行すべきでしょうか？',
      'how.tl.app': 'アプリ', 'how.tl.app.n': '1.45 秒でアイドル', 'how.tl.busy': 'リクエスト + 描画', 'how.tl.idle': 'アイドル', 'how.tl.next': '次へ',
      'how.tl.sleep': '固定の sleep', 'how.tl.sleep.n': '1.8 秒の無駄待ち',
      'how.tl.poll': '画面のポーリング', 'how.tl.poll.n': '0.35 秒早すぎ、失敗しうる',
      'how.tl.q.n': 'アイドルの瞬間に次のステップへ', 'how.tl.others': '他のツールの待ち方',
      'how.tl.foot': 'ポーリングは 0.3 秒ごとに画面を確認し、ボタンが見えた時点で操作します。アプリがまだ処理中でもです。Quiesco は処理そのものが終わるのを待ちます。',
      'feat.eyebrow': '<b>03</b> / 機能',
      'feat.h2': 'テストに必要なものはすべて。本番には何も残さない。',
      'feat.1.t': '自動同期', 'feat.1.d': 'ネットワーク、タイマー、React スケジューラ、idle コールバック、ネイティブの画面遷移、そしてフレーム安定のフォールバック。同期がタイムアウトすると、何がまだ動いていたかを示します。',
      'feat.2.t': '実際の入力を全プラットフォームで', 'feat.2.d': 'iOS と Android は <code>@quiesco/native</code>、Web は Playwright でタッチと文字を入力します。同じテストを変更なしで 3 つの環境で実行できます。',
      'feat.3.t': '約 200 ms のリセット', 'feat.3.d': '各テストの前にソフトリセット（ストレージ、リセット用フック、再マウント）を行います。再起動が本当に必要なテストには <code>@hard-reset</code> タグを付けます。',
      'feat.4.t': 'バックドア', 'feat.4.d': 'UI を操作せずにテストから状態を用意できます：<code>app.backdoor(\'loginAs\', …)</code>。ログインは一度で済ませ、肝心な部分をテストします。',
      'feat.5.t': 'テスト UI とリアルタイムの進捗', 'feat.5.d': '<code>quiesco ui</code> はブラウザからテストを実行し、失敗ごとにスクリーンショットと要素ツリーを表示します。CLI は最終行に進捗バーを表示します。',
      'feat.6.t': '本番には入らない', 'feat.6.d': '<code>EXPO_PUBLIC_QUIESCO=1</code> がなければエージェントは何もしないスタブに置き換わり、ネイティブモジュールもビルドから除外されます。CI で確認しています。',
      'qs.eyebrow': '<b>04</b> / クイックスタート',
      'qs.h2': '最初のテストまで約 10 分。',
      'qs.lead': 'Expo SDK 55 以降のアプリと Node.js 24 を用意してください。',
      'qs.1.t': '<code>npx quiesco init</code> を実行', 'qs.1.d': '依存関係、config plugin、Metro の設定、<code>quiesco.config.mts</code>、最初のテストを用意します。',
      'qs.2.t': 'ルートレイアウトを <code>&lt;QuiescoRoot&gt;</code> で囲む', 'qs.2.d': 'コンポーネントひとつで、e2e ビルドのときだけエージェントが有効になります。',
      'qs.3.t': '<code>npx quiesco test</code> を実行', 'qs.3.d': 'Chromium、iOS シミュレータ、Android エミュレータで実行できます。',
      'qs.any': '任意の Node.js テストランナー',
      'qs.c1': '// UI を操作せずに状態を用意', 'qs.c2': '// 各ステップはアプリがアイドルになってから実行',
      'close.h2': '速さか安定か、もう選ばなくていい。',
      'close.lead': 'オープンソース、MIT ライセンス。npm パッケージ名は <code>quiesco</code> です。',
      'close.bench': 'ベンチマークを見る',
      'bp.title': 'Quiesco ベンチマーク',
      'bp.desc': 'Quiesco、Appium、Detox、Maestro の iOS と Android でのシナリオ別所要時間、失敗率、テスト環境。',
      'bp.anno': 'セッション m5-final-none · 測定 2026-11-24 → 26（JST）',
      'bp.h1': '4 つの E2E ツール。<br>1 つの Expo アプリ。160 回の実行。',
      'bp.lead': 'Quiesco、Appium、Detox、Maestro が、同じ Expo SDK 58 のリリースビルドに対して同じ 24 シナリオのスイートを、プラットフォームごとに 20 回ずつ、同じ Apple M5 Pro 上で交互に実行しました。以下はその結果そのものです。中央値、ばらつき、失敗、そして各ツールが勝つ場面。',
      'bp.toc.suite': 'スイート全体', 'bp.toc.find': 'まずここを', 'bp.toc.sc': 'シナリオ別', 'bp.toc.env': 'テスト環境', 'bp.toc.method': '測定方法',
      'bp.suite.eyebrow': '<b>01</b> / スイート全体', 'bp.suite.h2': '共通シナリオでのスイート全体の所要時間',
      'bp.suite.lead': '単位は秒で、リセットを含みます。共通シナリオは、そのプラットフォームで全ツールが実行できる 22 シナリオです。iOS は S21 と S22、Android は S10b と S22 を除いています。',
      'bp.suite.note': 'Detox は Android の S23 で 1 回失敗したため、スイート時間は残りの 19 回で計算しています。Detox は iOS の S21 で毎回失敗しましたが、S21 は共通シナリオに含まれないため、スイート時間はあります。インストールと起動は中央値（秒）です。',
      'th.tool': 'ツール', 'th.median': '中央値', 'th.vsq': 'Quiesco 比', 'th.p90': 'p90', 'th.range': '最速 – 最遅', 'th.fails': 'スイート失敗',
      'th.rate': '失敗率（95% 区間）', 'th.install': 'インストール', 'th.launch': '起動',
      'bp.find.eyebrow': '<b>02</b> / まずここを', 'bp.find.h2': 'この数字からわかること、わからないこと',
      'bp.sc.eyebrow': '<b>03</b> / シナリオ別', 'bp.sc.h2': 'すべてのシナリオ、すべてのツール',
      'bp.sc.lead': '成功した実行の所要時間の中央値（秒）で、リセットは含みません。横軸は全シナリオ共通の対数目盛です。行をクリックすると p90、ばらつき、失敗率、リセット時間、エラーを表示します。',
      'bp.env.eyebrow': '<b>04</b> / テスト環境', 'bp.env.h2': 'テスト環境',
      'bp.method.eyebrow': '<b>05</b> / 測定方法', 'bp.method.h2': 'データの読み方',
    },
  };

  // Strings built by scripts. {name} placeholders are filled from vars.
  const DYN = {
    en: {
      'vs.title': 'vs {tool} · {plat}', 'vs.sub': 'suite time · {x}× faster · {s} s saved per run',
      's': 's',
      /* benchmark page */
      'kpi.next': '{plat} · vs next-fastest ({tool})', 'kpi.last': '{plat} · vs slowest ({tool})', 'kpi.meta': '{q} s vs {x} s · {r}×',
      'f.android.t': 'Quiesco is fastest in {n} of {total} Android scenarios',
      'f.android.b': 'Detox wins the remaining one (S8, native controls) by 0.6 s. Across the shared suite Quiesco takes {q} s against Appium\'s {a} s.',
      'f.ios.t': 'On iOS, Appium wins {a} scenarios; Quiesco wins {q}',
      'f.ios.b': 'In many short iOS flows Appium is about a second quicker. Quiesco\'s suite lead comes mostly from S6 (scrolling a long list: {s6q} s vs Appium {s6a} s) and from faster resets.',
      'f.reset.t': 'Resets are part of the suite time',
      'f.reset.b': 'Average reset per scenario on Android: Quiesco {aq} s, Detox {ad} s, Appium {aa} s, Maestro {am} s. On iOS: Quiesco {iq} s, Detox {id} s, Appium {ia} s, Maestro {im} s.',
      'f.stab.t': 'No suite failures for Quiesco or Maestro, but N = 20 limits the claim',
      'f.stab.b': 'Detox failed all 20 iOS runs on S21 (deep link) and 1 Android run on S23; Appium failed 3 iOS runs on S22 (notification). With 20 runs, 0 failures still has a 95% upper bound of 16.1%, so overlapping intervals are not a ranking.',
      'f.tag.android': 'Android', 'f.tag.ios': 'iOS', 'f.tag.reset': 'Resets', 'f.tag.stab': 'Stability',
      'sc.view.chart': 'Chart', 'sc.view.table': 'Numbers', 'sc.sort.id': 'Scenario order', 'sc.sort.lead': 'Quiesco lead', 'sc.shared': 'Shared scenarios only',
      'sc.col.sc': 'Scenario', 'sc.col.plot': 'Median per tool (s, log scale)', 'sc.col.q': 'Quiesco', 'sc.col.delta': 'vs best other',
      'sc.notshared': 'not shared', 'sc.skipped': '{tool} skipped', 'sc.allfailed': '{tool} all failed', 'sc.fails': '{tool} {f} fail',
      'sc.faster': '{p}% faster', 'sc.slower': '{p}% slower', 'sc.count': '{n} scenarios',
      'd.median': 'Median', 'd.p90': 'p90', 'd.range': 'Range', 'd.fails': 'Failures', 'd.ci': '95% CI', 'd.reset': 'Reset',
      'd.skipped': 'Skipped — the tool can\'t perform this action.', 'd.allfailed': 'All 20 runs failed', 'd.errors': 'Error on failure', 'd.fastest': 'fastest',
      'st.skipped': 'Skipped', 'st.failed': 'All failed',
    },
    zh: {
      'vs.title': '对比 {tool} · {plat}', 'vs.sub': '整套耗时 · 快 {x} 倍 · 每次省 {s} 秒',
      's': '秒',
      'kpi.next': '{plat} · 对比第二快（{tool}）', 'kpi.last': '{plat} · 对比最慢（{tool}）', 'kpi.meta': '{q} 秒 vs {x} 秒 · {r} 倍',
      'f.android.t': '在 {total} 个 Android 场景中，Quiesco 有 {n} 个最快',
      'f.android.b': '剩下的一个（S8 原生控件）Detox 快 0.6 秒。共同场景集的整套耗时，Quiesco 为 {q} 秒，Appium 为 {a} 秒。',
      'f.ios.t': '在 iOS 上，Appium 赢 {a} 个场景，Quiesco 赢 {q} 个',
      'f.ios.b': '在不少较短的 iOS 流程里，Appium 快 1 秒左右。Quiesco 的整套领先主要来自 S6（长列表滚动：{s6q} 秒，Appium {s6a} 秒）和更快的重置。',
      'f.reset.t': '重置时间计入整套耗时',
      'f.reset.b': 'Android 上每个场景的平均重置时间：Quiesco {aq} 秒，Detox {ad} 秒，Appium {aa} 秒，Maestro {am} 秒。iOS：Quiesco {iq} 秒，Detox {id} 秒，Appium {ia} 秒，Maestro {im} 秒。',
      'f.stab.t': 'Quiesco 和 Maestro 没有整套失败，但 N = 20 限制了结论',
      'f.stab.b': 'Detox 在 iOS 的 S21（深链接）20 次全部失败，在 Android 的 S23 失败 1 次；Appium 在 iOS 的 S22（通知）失败 3 次。20 次运行中 0 次失败，95% 区间上限仍是 16.1%，区间重叠的工具不能排出稳定性高低。',
      'f.tag.android': 'Android', 'f.tag.ios': 'iOS', 'f.tag.reset': '重置', 'f.tag.stab': '稳定性',
      'sc.view.chart': '图表', 'sc.view.table': '数字', 'sc.sort.id': '场景顺序', 'sc.sort.lead': 'Quiesco 领先幅度', 'sc.shared': '只看共同场景',
      'sc.col.sc': '场景', 'sc.col.plot': '各工具耗时中位数（秒，对数刻度）', 'sc.col.q': 'Quiesco', 'sc.col.delta': '对比最快的其他工具',
      'sc.notshared': '不在共同集', 'sc.skipped': '{tool} 跳过', 'sc.allfailed': '{tool} 全部失败', 'sc.fails': '{tool} 失败 {f} 次',
      'sc.faster': '快 {p}%', 'sc.slower': '慢 {p}%', 'sc.count': '{n} 个场景',
      'd.median': '中位数', 'd.p90': 'p90', 'd.range': '范围', 'd.fails': '失败', 'd.ci': '95% 区间', 'd.reset': '重置',
      'd.skipped': '跳过：该工具做不到这个操作。', 'd.allfailed': '20 次全部失败', 'd.errors': '失败时的报错', 'd.fastest': '最快',
      'st.skipped': '跳过', 'st.failed': '全部失败',
    },
    ja: {
      'vs.title': '{tool} 比 · {plat}', 'vs.sub': 'スイート全体 · {x} 倍速い · 1 回あたり {s} 秒短縮',
      's': '秒',
      'kpi.next': '{plat} · 次に速いツール（{tool}）比', 'kpi.last': '{plat} · 最も遅いツール（{tool}）比', 'kpi.meta': '{q} 秒 vs {x} 秒 · {r} 倍',
      'f.android.t': 'Android の {total} シナリオ中 {n} で Quiesco が最速',
      'f.android.b': '残る 1 つ（S8 ネイティブコントロール）は Detox が 0.6 秒速い結果でした。共通シナリオのスイート全体では、Quiesco が {q} 秒、Appium が {a} 秒です。',
      'f.ios.t': 'iOS では Appium が {a} シナリオ、Quiesco が {q} シナリオで最速',
      'f.ios.b': '短い iOS のフローでは Appium が 1 秒ほど速いことが多くあります。Quiesco のスイート全体でのリードは、主に S6（長いリストのスクロール：{s6q} 秒、Appium は {s6a} 秒）と速いリセットによるものです。',
      'f.reset.t': 'リセット時間もスイートの所要時間に含まれる',
      'f.reset.b': 'Android のシナリオあたり平均リセット時間：Quiesco {aq} 秒、Detox {ad} 秒、Appium {aa} 秒、Maestro {am} 秒。iOS：Quiesco {iq} 秒、Detox {id} 秒、Appium {ia} 秒、Maestro {im} 秒。',
      'f.stab.t': 'Quiesco と Maestro はスイート失敗ゼロ。ただし N = 20 では断定できない',
      'f.stab.b': 'Detox は iOS の S21（ディープリンク）で 20 回すべて、Android の S23 で 1 回失敗。Appium は iOS の S22（通知）で 3 回失敗しました。20 回中 0 回の失敗でも 95% 区間の上限は 16.1% なので、区間が重なるツール同士で安定性の順位は付けられません。',
      'f.tag.android': 'Android', 'f.tag.ios': 'iOS', 'f.tag.reset': 'リセット', 'f.tag.stab': '安定性',
      'sc.view.chart': 'チャート', 'sc.view.table': '数値', 'sc.sort.id': 'シナリオ順', 'sc.sort.lead': 'Quiesco のリード順', 'sc.shared': '共通シナリオのみ',
      'sc.col.sc': 'シナリオ', 'sc.col.plot': 'ツール別の中央値（秒、対数目盛）', 'sc.col.q': 'Quiesco', 'sc.col.delta': '最速の他ツール比',
      'sc.notshared': '共通外', 'sc.skipped': '{tool} スキップ', 'sc.allfailed': '{tool} 全失敗', 'sc.fails': '{tool} 失敗 {f} 回',
      'sc.faster': '{p}% 速い', 'sc.slower': '{p}% 遅い', 'sc.count': '{n} シナリオ',
      'd.median': '中央値', 'd.p90': 'p90', 'd.range': '範囲', 'd.fails': '失敗', 'd.ci': '95% 区間', 'd.reset': 'リセット',
      'd.skipped': 'スキップ：このツールではこの操作ができません。', 'd.allfailed': '20 回すべて失敗', 'd.errors': '失敗時のエラー', 'd.fastest': '最速',
      'st.skipped': 'スキップ', 'st.failed': '全失敗',
    },
  };

  // Scenario names (en is also in benchmark-data.js).
  const SCENARIOS = {
    zh: { S1: '登录成功后进入列表', S2: '错误邮箱的校验提示', S3: '防抖搜索', S4: '新增条目并在刷新后保留', S5: '删除条目，确认 Modal', S6: '长列表滚动到第 400 行', S7a: '中文 / 日文输入（文本 API）', S8: '原生控件', S9: 'WebView', S10a: '系统权限（预先授权）', S10b: '系统权限（点系统弹窗）', S11: '永不静止的动画', S12: '左滑删除', S13: '下拉刷新', S14: '长按菜单与拖拽排序', S15: 'Reanimated 动画', S16: '轮询与 WebSocket', S17: '自动消失的 Toast', S18: '错误态与重试', S19: 'Tab 与嵌套导航', S20: '键盘遮挡', S21: '深链接', S22: '本地通知', S23: '前后台切换与持久化' },
    ja: { S1: 'ログインしてリストへ', S2: '不正なメールアドレスの検証メッセージ', S3: 'デバウンス検索', S4: '項目を追加し、リフレッシュ後も保持', S5: '確認モーダルで項目を削除', S6: '長いリストを 400 行目までスクロール', S7a: '中国語・日本語入力（テキスト API）', S8: 'ネイティブコントロール', S9: 'WebView', S10a: 'システム権限（事前許可）', S10b: 'システム権限（システムダイアログをタップ）', S11: '止まらないアニメーション', S12: 'スワイプで削除', S13: 'プル・トゥ・リフレッシュ', S14: '長押しメニューとドラッグで並べ替え', S15: 'Reanimated アニメーション', S16: 'ポーリングと WebSocket', S17: '自動で消えるトースト', S18: 'エラー状態とリトライ', S19: 'タブとネストしたナビゲーション', S20: 'キーボードによる入力欄の隠れ', S21: 'ディープリンク', S22: 'ローカル通知', S23: 'バックグラウンド・フォアグラウンド切り替えと永続化' },
  };

  const enCache = {};
  const enAttr = {};

  function detect() {
    try {
      const q = new URLSearchParams(location.search).get('lang');
      if (SUPPORTED.includes(q)) return q;
      const s = localStorage.getItem('quiesco-lang');
      if (SUPPORTED.includes(s)) return s;
    } catch {}
    for (const l of navigator.languages || [navigator.language || 'en']) {
      const p = l.toLowerCase().slice(0, 2);
      if (SUPPORTED.includes(p)) return p;
    }
    return 'en';
  }

  let lang = detect();

  function t(key, vars) {
    const s = (DYN[lang] && DYN[lang][key]) ?? DYN.en[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (_, n) => (vars[n] ?? '')) : s;
  }
  function scenario(id, en) { return lang === 'en' ? en : (SCENARIOS[lang][id] ?? en); }
  // Pick from an inline {en, zh, ja} object.
  function pick(o) { return typeof o === 'string' ? o : (o[lang] ?? o.en); }

  function apply() {
    const root = document.documentElement;
    root.lang = lang === 'zh' ? 'zh-CN' : lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const k = el.dataset.i18n;
      if (!(k in enCache)) enCache[k] = el.innerHTML;
      el.innerHTML = lang === 'en' ? enCache[k] : (STATIC[lang][k] ?? enCache[k]);
    });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      for (const pair of el.dataset.i18nAttr.split(';')) {
        const [attr, k] = pair.split(':');
        const id = attr + '|' + k;
        if (!(id in enAttr)) enAttr[id] = el.getAttribute(attr);
        el.setAttribute(attr, lang === 'en' ? enAttr[id] : (STATIC[lang][k] ?? enAttr[id]));
      }
    });
    document.querySelectorAll('.lang [data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
  }

  function set(next) {
    if (!SUPPORTED.includes(next) || next === lang) return;
    lang = next;
    try { localStorage.setItem('quiesco-lang', lang); } catch {}
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('lang')) { u.searchParams.set('lang', lang); history.replaceState(null, '', u); }
    } catch {}
    apply();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('.lang [data-lang]');
    if (b) set(b.dataset.lang);
  });

  window.QI18N = { t, scenario, pick, get lang() { return lang; }, apply, set };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
