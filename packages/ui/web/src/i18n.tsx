/**
 * UI languages: English, 简体中文, 日本語. Every dictionary has exactly the English keys (a missing key
 * fails the type check). `{name}` placeholders are filled by `t()`. Test names and file paths are the
 * user's own text and are never translated.
 *
 * The language: the one chosen in the page (remembered), else the browser's first of zh / ja / en.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const en = {
  skipToDetails: 'Skip to test details',
  searchLabel: 'Search tests',
  searchPlaceholder: 'Search tests, files or @tags',
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
  themeToLight: 'Switch to light theme',
  themeToDark: 'Switch to dark theme',
  language: 'Language',
  stop: 'Stop',
  stopTitle: 'Stop the run (Ctrl/⌘ + .)',
  runAll: 'Run all',
  running: 'Running…',
  runAllTitle: 'Run all tests (Ctrl/⌘ + Enter)',
  busyTitle: 'A run is in progress: one device, one run at a time',
  disconnectedBanner: 'Disconnected from quiesco ui. Reconnecting… (is quiesco ui still running?)',
  dismiss: 'Dismiss',
  noEvents: 'The run sent no test events, so the tree cannot follow it.',
  noEventsVitest: 'Add quiescoPlugin() to the plugins of your Vitest config.',
  noEventsJest: "Your Jest config replaces the preset's reporters: add '@quiesco/jest/reporter'.",
  noEventsCucumber: 'Install @quiesco/cucumber in this project.',
  runFinished: 'Run finished: {passed} passed, {failed} failed, {skipped} skipped.',
  noticeBusy: 'A run is already in progress (one device: one run at a time).',
  noticeUnknownTests: 'None of the chosen tests is known any more. List the tests again.',
  runProgress: 'Run progress',
  ringLabel: '{done} of {total} tests done, {failed} failed',
  testsDone: 'Tests done',
  starting: 'Starting the run (device and app)…',
  listing: 'Listing tests…',
  notRunYetCount: '{n} tests · not run yet',
  doneElapsed: 'done · {elapsed}',
  totalGrowing: 'total still growing',
  endedStopped: 'stopped · {elapsed}',
  endedPassed: 'passed · {elapsed}',
  endedFailed: 'failed · {elapsed}',
  nPassed: '{n} passed',
  nFailed: '{n} failed',
  nSkipped: '{n} skipped',
  device: 'Device {n}',
  tests: 'Tests',
  treeLabel: 'Test files and tests',
  filterLabel: 'Filter by status',
  filterAll: 'All',
  filterFailed: 'Failed',
  filterRunning: 'Running',
  filterSkipped: 'Skipped',
  filterPassed: 'Passed',
  sort: 'Sort',
  sortFile: 'File order',
  sortFailed: 'Failed first',
  sortSlowest: 'Slowest first',
  relist: 'List the tests again',
  waitingList: 'Waiting for the test list…',
  noMatch: 'No test matches.',
  noTests: 'No tests found.',
  runItem: 'Run {name}',
  runTestTitle: 'Run this test (r)',
  fileError: 'error',
  hintMove: 'move',
  hintRun: 'run',
  hintRunAll: 'run all',
  hintStop: 'stop',
  hintSearch: 'search',
  testDetails: 'Test details',
  pickTest: 'Pick a test',
  pickTestHelp: 'Select a test in the tree to see its result, evidence, output and source. Press Run all to run everything.',
  attempt: 'attempt {n}',
  run: 'Run',
  runAgain: 'Run again',
  runAgainTitle: 'Run this test again',
  detailView: 'Detail view',
  tabReport: 'Report',
  tabEvidence: 'Evidence',
  tabConsole: 'Console',
  tabSource: 'Source',
  passedIn: 'Passed in {d}.',
  passedPlain: 'Passed.',
  notRunHelp: 'Not run yet in this session. Run it with the button above, or press r in the tree.',
  waitingTurn: 'Waiting for its turn in this run.',
  difference: 'Difference',
  stack: 'Stack',
  evidenceSaved: 'Evidence saved at the failure',
  viewEvidence: 'View evidence',
  noEvidenceFailed: 'No evidence was saved for this failure (artifacts policy, or the run was stopped).',
  evidenceHelp: 'Quiesco saves evidence (screenshot, element tree, idle state, logs) when a test fails.',
  enlarge: 'Enlarge {file}',
  screenshotOf: 'Screenshot: {file}',
  screenshot: 'Screenshot',
  open: 'Open',
  loading: 'Loading…',
  unreadable: '(could not be read)',
  moreLines: '… ({n} more lines: Open)',
  thisTest: 'This test',
  noTestOutput: 'No output kept for this test (Vitest keeps console output per test; cucumber keeps this.log()).',
  runnerOutput: 'Runner output (last run)',
  nothingYet: 'Nothing yet.',
  loadingFile: 'Loading {file}…',
  fileUnreadable: '{file} could not be read.',
  readOnly: '{file} · read-only',
  statusPassed: 'Passed',
  statusFailed: 'Failed',
  statusSkipped: 'Skipped',
  statusTodo: 'Todo',
  statusPending: 'Pending',
  statusUndefined: 'Undefined step',
  statusNotRun: 'Not run',
  statusRunning: 'Running',
  statusQueued: 'Queued',
  statusIdle: 'Not run yet',
};

export type MessageKey = keyof typeof en;
type Dictionary = Record<MessageKey, string>;

const zh: Dictionary = {
  skipToDetails: '跳到测试详情',
  searchLabel: '搜索测试',
  searchPlaceholder: '搜索测试、文件或 @tag',
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '已断开',
  themeToLight: '切换到亮色主题',
  themeToDark: '切换到暗色主题',
  language: '语言',
  stop: '停止',
  stopTitle: '停止运行（Ctrl/⌘ + .）',
  runAll: '全部运行',
  running: '运行中…',
  runAllTitle: '运行全部测试（Ctrl/⌘ + Enter）',
  busyTitle: '正在运行：一个设备同一时间只能跑一次',
  disconnectedBanner: '与 quiesco ui 的连接已断开，正在重连…（quiesco ui 还在运行吗？）',
  dismiss: '关闭',
  noEvents: '这次运行没有发来测试事件，测试树无法跟踪进度。',
  noEventsVitest: '请在 Vitest 配置的 plugins 里加上 quiescoPlugin()。',
  noEventsJest: "你的 Jest 配置替换了 preset 的 reporters：请加上 '@quiesco/jest/reporter'。",
  noEventsCucumber: '请在本项目中安装 @quiesco/cucumber。',
  runFinished: '运行结束：{passed} 个通过，{failed} 个失败，{skipped} 个跳过。',
  noticeBusy: '已有运行在进行（一个设备同一时间只能跑一次）。',
  noticeUnknownTests: '选中的测试已不存在，请重新列出测试。',
  runProgress: '运行进度',
  ringLabel: '已完成 {done} / {total} 个测试，{failed} 个失败',
  testsDone: '已完成的测试',
  starting: '正在启动（设备与 App）…',
  listing: '正在列出测试…',
  notRunYetCount: '{n} 个测试 · 尚未运行',
  doneElapsed: '已完成 · {elapsed}',
  totalGrowing: '总数仍在增加',
  endedStopped: '已停止 · {elapsed}',
  endedPassed: '通过 · {elapsed}',
  endedFailed: '失败 · {elapsed}',
  nPassed: '{n} 通过',
  nFailed: '{n} 失败',
  nSkipped: '{n} 跳过',
  device: '设备 {n}',
  tests: '测试',
  treeLabel: '测试文件与测试',
  filterLabel: '按状态过滤',
  filterAll: '全部',
  filterFailed: '失败',
  filterRunning: '运行中',
  filterSkipped: '跳过',
  filterPassed: '通过',
  sort: '排序',
  sortFile: '文件顺序',
  sortFailed: '失败优先',
  sortSlowest: '最慢优先',
  relist: '重新列出测试',
  waitingList: '正在等待测试列表…',
  noMatch: '没有匹配的测试。',
  noTests: '没有找到测试。',
  runItem: '运行 {name}',
  runTestTitle: '运行这个测试（r）',
  fileError: '错误',
  hintMove: '移动',
  hintRun: '运行',
  hintRunAll: '全部运行',
  hintStop: '停止',
  hintSearch: '搜索',
  testDetails: '测试详情',
  pickTest: '选择一个测试',
  pickTestHelp: '在左侧测试树中选择一个测试，查看结果、证据、输出和源码。点「全部运行」运行所有测试。',
  attempt: '第 {n} 次尝试',
  run: '运行',
  runAgain: '重跑',
  runAgainTitle: '再运行一次这个测试',
  detailView: '详情视图',
  tabReport: '报告',
  tabEvidence: '证据',
  tabConsole: '控制台',
  tabSource: '源码',
  passedIn: '通过，用时 {d}。',
  passedPlain: '通过。',
  notRunHelp: '本次会话中尚未运行。点上方按钮运行，或在测试树中按 r。',
  waitingTurn: '正在等待轮到它运行。',
  difference: '差异',
  stack: '堆栈',
  evidenceSaved: '失败时的证据已保存',
  viewEvidence: '查看证据',
  noEvidenceFailed: '这次失败没有保存证据（artifacts 设置，或运行被停止）。',
  evidenceHelp: '测试失败时，Quiesco 会保存证据（截图、元素树、空闲状态、日志）。',
  enlarge: '放大 {file}',
  screenshotOf: '截图：{file}',
  screenshot: '截图',
  open: '打开',
  loading: '加载中…',
  unreadable: '（无法读取）',
  moreLines: '…（还有 {n} 行：点「打开」查看）',
  thisTest: '这个测试',
  noTestOutput: '没有保留这个测试的输出（Vitest 按测试保留控制台输出；cucumber 保留 this.log()）。',
  runnerOutput: 'Runner 输出（最近一次运行）',
  nothingYet: '暂无输出。',
  loadingFile: '正在加载 {file}…',
  fileUnreadable: '无法读取 {file}。',
  readOnly: '{file} · 只读',
  statusPassed: '通过',
  statusFailed: '失败',
  statusSkipped: '跳过',
  statusTodo: '待办',
  statusPending: '待实现',
  statusUndefined: '步骤未定义',
  statusNotRun: '未运行',
  statusRunning: '运行中',
  statusQueued: '排队中',
  statusIdle: '尚未运行',
};

const ja: Dictionary = {
  skipToDetails: 'テストの詳細へスキップ',
  searchLabel: 'テストを検索',
  searchPlaceholder: 'テスト名・ファイル・@タグで検索',
  connected: '接続済み',
  connecting: '接続しています…',
  disconnected: '切断されました',
  themeToLight: 'ライトテーマに切り替え',
  themeToDark: 'ダークテーマに切り替え',
  language: '言語',
  stop: '停止',
  stopTitle: '実行を停止（Ctrl/⌘ + .）',
  runAll: 'すべて実行',
  running: '実行中…',
  runAllTitle: 'すべてのテストを実行（Ctrl/⌘ + Enter）',
  busyTitle: '実行中です。デバイスは 1 台なので、同時に実行できるのは 1 回だけです',
  disconnectedBanner: 'quiesco ui との接続が切れました。再接続しています…（quiesco ui は起動したままですか？）',
  dismiss: '閉じる',
  noEvents: 'この実行からテストのイベントが届かなかったため、進捗を追えません。',
  noEventsVitest: 'Vitest の設定の plugins に quiescoPlugin() を追加してください。',
  noEventsJest: "Jest の設定が preset の reporters を上書きしています。'@quiesco/jest/reporter' を追加してください。",
  noEventsCucumber: 'このプロジェクトに @quiesco/cucumber をインストールしてください。',
  runFinished: '実行が終わりました：成功 {passed} 件、失敗 {failed} 件、スキップ {skipped} 件。',
  noticeBusy: 'すでに実行中です（デバイスは 1 台なので、同時に実行できるのは 1 回だけです）。',
  noticeUnknownTests: '選択したテストが見つかりません。テストを一覧し直してください。',
  runProgress: '実行の進捗',
  ringLabel: '{total} 件中 {done} 件完了、失敗 {failed} 件',
  testsDone: '完了したテスト',
  starting: '起動しています（デバイスとアプリ）…',
  listing: 'テストを一覧しています…',
  notRunYetCount: '{n} 件のテスト · 未実行',
  doneElapsed: '完了 · {elapsed}',
  totalGrowing: '総数はまだ増えています',
  endedStopped: '停止 · {elapsed}',
  endedPassed: '成功 · {elapsed}',
  endedFailed: '失敗 · {elapsed}',
  nPassed: '成功 {n}',
  nFailed: '失敗 {n}',
  nSkipped: 'スキップ {n}',
  device: 'デバイス {n}',
  tests: 'テスト',
  treeLabel: 'テストファイルとテスト',
  filterLabel: '状態で絞り込み',
  filterAll: 'すべて',
  filterFailed: '失敗',
  filterRunning: '実行中',
  filterSkipped: 'スキップ',
  filterPassed: '成功',
  sort: '並べ替え',
  sortFile: 'ファイル順',
  sortFailed: '失敗を先に',
  sortSlowest: '遅い順',
  relist: 'テストを一覧し直す',
  waitingList: 'テストの一覧を待っています…',
  noMatch: '一致するテストはありません。',
  noTests: 'テストが見つかりません。',
  runItem: '{name} を実行',
  runTestTitle: 'このテストを実行（r）',
  fileError: 'エラー',
  hintMove: '移動',
  hintRun: '実行',
  hintRunAll: 'すべて実行',
  hintStop: '停止',
  hintSearch: '検索',
  testDetails: 'テストの詳細',
  pickTest: 'テストを選んでください',
  pickTestHelp: '左のツリーでテストを選ぶと、結果・証拠・出力・ソースを確認できます。「すべて実行」ですべてのテストを実行します。',
  attempt: '{n} 回目の試行',
  run: '実行',
  runAgain: 'もう一度実行',
  runAgainTitle: 'このテストをもう一度実行',
  detailView: '詳細の表示',
  tabReport: 'レポート',
  tabEvidence: '証拠',
  tabConsole: 'コンソール',
  tabSource: 'ソース',
  passedIn: '成功しました（{d}）。',
  passedPlain: '成功しました。',
  notRunHelp: 'このセッションではまだ実行していません。上のボタンか、ツリーで r キーを押すと実行します。',
  waitingTurn: 'この実行で順番を待っています。',
  difference: '差分',
  stack: 'スタック',
  evidenceSaved: '失敗時の証拠を保存しました',
  viewEvidence: '証拠を見る',
  noEvidenceFailed: 'この失敗では証拠が保存されていません（artifacts の設定、または実行の停止）。',
  evidenceHelp: 'テストが失敗すると、Quiesco が証拠（スクリーンショット・要素ツリー・アイドル状態・ログ）を保存します。',
  enlarge: '{file} を拡大',
  screenshotOf: 'スクリーンショット：{file}',
  screenshot: 'スクリーンショット',
  open: '開く',
  loading: '読み込んでいます…',
  unreadable: '（読み込めませんでした）',
  moreLines: '…（残り {n} 行：「開く」で表示）',
  thisTest: 'このテスト',
  noTestOutput: 'このテストの出力は保存されていません（Vitest はテストごとにコンソール出力を保存し、cucumber は this.log() を保存します）。',
  runnerOutput: 'ランナーの出力（直近の実行）',
  nothingYet: 'まだありません。',
  loadingFile: '{file} を読み込んでいます…',
  fileUnreadable: '{file} を読み込めませんでした。',
  readOnly: '{file} · 読み取り専用',
  statusPassed: '成功',
  statusFailed: '失敗',
  statusSkipped: 'スキップ',
  statusTodo: 'TODO',
  statusPending: '保留',
  statusUndefined: '未定義のステップ',
  statusNotRun: '未実行',
  statusRunning: '実行中',
  statusQueued: '待機中',
  statusIdle: '未実行',
};

export type Locale = 'en' | 'zh' | 'ja';
export const LOCALES: { id: Locale; label: string; htmlLang: string }[] = [
  { id: 'en', label: 'English', htmlLang: 'en' },
  { id: 'zh', label: '简体中文', htmlLang: 'zh-CN' },
  { id: 'ja', label: '日本語', htmlLang: 'ja' },
];
/** All messages by language (tests check them). */
export const MESSAGES: Record<Locale, Dictionary> = { en, zh, ja };
const DICTIONARIES = MESSAGES;
const STORAGE_KEY = 'quiesco-ui-locale';

export function detectLocale(saved: string | null, languages: readonly string[]): Locale {
  if (saved === 'en' || saved === 'zh' || saved === 'ja') return saved;
  for (const l of languages) {
    const lower = l.toLowerCase();
    if (lower.startsWith('zh')) return 'zh';
    if (lower.startsWith('ja')) return 'ja';
    if (lower.startsWith('en')) return 'en';
  }
  return 'en';
}

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const dict = DICTIONARIES[locale];
  return (key, params) => {
    const text = dict[key];
    return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
  };
}

interface I18n {
  locale: Locale;
  setLocale(l: Locale): void;
  t: Translate;
}

const I18nContext = createContext<I18n>({ locale: 'en', setLocale: () => {}, t: translator('en') });

function savedLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale(savedLocale(), navigator.languages ?? [navigator.language]));
  useEffect(() => {
    document.documentElement.lang = LOCALES.find((l) => l.id === locale)?.htmlLang ?? 'en';
  }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Not remembered: fine.
    }
  }, []);
  const value = useMemo(() => ({ locale, setLocale, t: translator(locale) }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
