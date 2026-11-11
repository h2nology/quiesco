/**
 * The generic steps (requirements.md §6.11), in Chinese, Japanese and English.
 *
 * These are operation scripts, not requirements: they describe taps and texts, not what the user wants
 * to achieve. Use them while prototyping or exploring; a real project writes business-language steps
 * ("When the user logs in as …") on top of `this.app` or its own driver.
 *
 * A quoted target is a testID (`点击 "add-todo"`); the "…文本 / テキスト / the text …" variants match
 * the displayed text instead.
 */
import type { Driver } from '@quiesco/core';

export type Language = 'zh' | 'ja' | 'en';

export interface GenericStep {
  /** Stable name, e.g. for docs. */
  name: string;
  /** Cucumber expression per language. Parameters are passed to `run` in the order they appear. */
  expressions: Record<Language, string>;
  /** Example step text per language (docs and tests). */
  examples: Record<Language, string>;
  /** Maps the language's parameters to `run` arguments when their order differs from `zh`. */
  order?: Partial<Record<Language, number[]>>;
  run(app: Driver, ...args: (string | number)[]): Promise<unknown>;
}

const s = (v: string | number | undefined): string => String(v);

/** A word from the step text mapped to an API value; the same table serves every language. */
function word<T>(kind: string, table: Record<string, T>, v: string | number | undefined): T {
  const key = s(v).trim().toLowerCase();
  const hit = table[key];
  if (hit === undefined) throw new Error(`Unknown ${kind} "${s(v)}": use one of ${Object.keys(table).join(', ')}`);
  return hit;
}

type Direction = 'up' | 'down' | 'left' | 'right';
const DIRECTIONS: Record<string, Direction> = { 上: 'up', 下: 'down', 左: 'left', 右: 'right', up: 'up', down: 'down', left: 'left', right: 'right' };
type Edge = 'top' | 'bottom' | 'left' | 'right';
const EDGES: Record<string, Edge> = {
  顶部: 'top', 底部: 'bottom', 最左边: 'left', 最右边: 'right',
  一番上: 'top', 一番下: 'bottom', 左端: 'left', 右端: 'right',
  top: 'top', bottom: 'bottom', left: 'left', right: 'right',
};
const ORIENTATIONS: Record<string, 'portrait' | 'landscape'> = { 竖屏: 'portrait', 横屏: 'landscape', 縦向き: 'portrait', 横向き: 'landscape', portrait: 'portrait', landscape: 'landscape' };
const APPEARANCES: Record<string, 'light' | 'dark'> = { 浅色: 'light', 深色: 'dark', ライト: 'light', ダーク: 'dark', light: 'light', dark: 'dark' };
type Permission = 'camera' | 'microphone' | 'location' | 'notifications' | 'contacts' | 'photos' | 'calendar';
const PERMISSIONS: Record<string, Permission> = {
  相机: 'camera', 麦克风: 'microphone', 定位: 'location', 通知: 'notifications', 通讯录: 'contacts', 照片: 'photos', 日历: 'calendar',
  カメラ: 'camera', マイク: 'microphone', 位置情報: 'location', 連絡先: 'contacts', 写真: 'photos', カレンダー: 'calendar',
  camera: 'camera', microphone: 'microphone', location: 'location', notifications: 'notifications', contacts: 'contacts', photos: 'photos', calendar: 'calendar',
};

export const GENERIC_STEPS: readonly GenericStep[] = [
  {
    name: 'tap',
    expressions: { zh: '点击 {string}', ja: '{string} をタップする', en: 'I tap {string}' },
    examples: { zh: '点击 "add-todo"', ja: '"add-todo" をタップする', en: 'I tap "add-todo"' },
    run: (app, id) => app.tap(s(id)),
  },
  {
    name: 'tapText',
    expressions: { zh: '点击文本 {string}', ja: 'テキスト {string} をタップする', en: 'I tap the text {string}' },
    examples: { zh: '点击文本 "保存"', ja: 'テキスト "保存" をタップする', en: 'I tap the text "Save"' },
    run: (app, text) => app.tap({ text: s(text) }),
  },
  {
    name: 'longPress',
    expressions: { zh: '长按 {string}', ja: '{string} を長押しする', en: 'I long press {string}' },
    examples: { zh: '长按 "todo-item"', ja: '"todo-item" を長押しする', en: 'I long press "todo-item"' },
    run: (app, id) => app.longPress(s(id)),
  },
  {
    name: 'type',
    expressions: { zh: '在 {string} 中输入 {string}', ja: '{string} に {string} と入力する', en: 'I type {string} into {string}' },
    examples: { zh: '在 "todo-title" 中输入 "买牛奶"', ja: '"todo-title" に "牛乳を買う" と入力する', en: 'I type "Buy milk" into "todo-title"' },
    // en names the text first: run(target, text)
    order: { en: [1, 0] },
    run: (app, id, text) => app.type(s(id), s(text)),
  },
  {
    name: 'clear',
    expressions: { zh: '清空 {string} 的内容', ja: '{string} の入力をクリアする', en: 'I clear {string}' },
    examples: { zh: '清空 "todo-title" 的内容', ja: '"todo-title" の入力をクリアする', en: 'I clear "todo-title"' },
    run: (app, id) => app.clear(s(id)),
  },
  {
    name: 'scrollTo',
    expressions: { zh: '在 {string} 中滚动到 {string}', ja: '{string} を {string} までスクロールする', en: 'I scroll {string} to {string}' },
    examples: { zh: '在 "todo-list" 中滚动到 "todo-item-30"', ja: '"todo-list" を "todo-item-30" までスクロールする', en: 'I scroll "todo-list" to "todo-item-30"' },
    run: (app, container, target) => app.scrollTo(s(container), s(target)),
  },
  {
    name: 'dismissKeyboard',
    expressions: { zh: '收起键盘', ja: 'キーボードを閉じる', en: 'I dismiss the keyboard' },
    examples: { zh: '收起键盘', ja: 'キーボードを閉じる', en: 'I dismiss the keyboard' },
    run: (app) => app.dismissKeyboard(),
  },
  {
    name: 'pressBack',
    expressions: { zh: '按返回键', ja: '戻るボタンを押す', en: 'I press back' },
    examples: { zh: '按返回键', ja: '戻るボタンを押す', en: 'I press back' },
    run: (app) => app.pressBack(),
  },
  {
    name: 'openUrl',
    expressions: { zh: '打开链接 {string}', ja: 'リンク {string} を開く', en: 'I open the link {string}' },
    examples: { zh: '打开链接 "myapp://todos"', ja: 'リンク "myapp://todos" を開く', en: 'I open the link "myapp://todos"' },
    run: (app, url) => app.openUrl(s(url)),
  },
  {
    name: 'seeText',
    expressions: { zh: '看到文本 {string}', ja: 'テキスト {string} が表示されている', en: 'I see the text {string}' },
    examples: { zh: '看到文本 "买牛奶"', ja: 'テキスト "牛乳を買う" が表示されている', en: 'I see the text "Buy milk"' },
    run: (app, text) => app.expectVisible({ text: s(text) }),
  },
  {
    name: 'notSeeText',
    expressions: { zh: '看不到文本 {string}', ja: 'テキスト {string} が表示されていない', en: 'I do not see the text {string}' },
    examples: { zh: '看不到文本 "买牛奶"', ja: 'テキスト "牛乳を買う" が表示されていない', en: 'I do not see the text "Buy milk"' },
    run: (app, text) => app.expectNotVisible({ text: s(text) }),
  },
  {
    name: 'visible',
    expressions: { zh: '元素 {string} 可见', ja: '要素 {string} が表示されている', en: 'the element {string} is visible' },
    examples: { zh: '元素 "todo-list" 可见', ja: '要素 "todo-list" が表示されている', en: 'the element "todo-list" is visible' },
    run: (app, id) => app.expectVisible(s(id)),
  },
  {
    name: 'notVisible',
    expressions: { zh: '元素 {string} 不可见', ja: '要素 {string} が表示されていない', en: 'the element {string} is not visible' },
    examples: { zh: '元素 "todo-title-error" 不可见', ja: '要素 "todo-title-error" が表示されていない', en: 'the element "todo-title-error" is not visible' },
    run: (app, id) => app.expectNotVisible(s(id)),
  },
  {
    name: 'hasText',
    expressions: { zh: '元素 {string} 的文本是 {string}', ja: '要素 {string} のテキストが {string} である', en: 'the element {string} has the text {string}' },
    examples: { zh: '元素 "greeting" 的文本是 "a@example.com"', ja: '要素 "greeting" のテキストが "a@example.com" である', en: 'the element "greeting" has the text "a@example.com"' },
    run: (app, id, text) => app.expectText(s(id), s(text)),
  },
  {
    name: 'count',
    expressions: { zh: '元素 {string} 共有 {int} 个', ja: '要素 {string} が {int} 個ある', en: 'there are {int} elements {string}' },
    examples: { zh: '元素 "todo-item" 共有 2 个', ja: '要素 "todo-item" が 2 個ある', en: 'there are 2 elements "todo-item"' },
    // en names the count first: run(target, count)
    order: { en: [1, 0] },
    run: (app, id, count) => app.expectCount(s(id), Number(count)),
  },
  // ---- Phase 6.2 – 6.4: more actions ----
  {
    name: 'doubleTap',
    expressions: { zh: '双击 {string}', ja: '{string} をダブルタップする', en: 'I double tap {string}' },
    examples: { zh: '双击 "photo"', ja: '"photo" をダブルタップする', en: 'I double tap "photo"' },
    run: (app, id) => app.doubleTap(s(id)),
  },
  {
    name: 'replaceText',
    expressions: { zh: '把 {string} 的内容替换为 {string}', ja: '{string} の入力を {string} に置き換える', en: 'I replace the text of {string} with {string}' },
    examples: { zh: '把 "todo-title" 的内容替换为 "买面包"', ja: '"todo-title" の入力を "パンを買う" に置き換える', en: 'I replace the text of "todo-title" with "Buy bread"' },
    run: (app, id, text) => app.replaceText(s(id), s(text)),
  },
  {
    name: 'pressEnter',
    expressions: { zh: '在 {string} 中按回车', ja: '{string} でエンターキーを押す', en: 'I press enter in {string}' },
    examples: { zh: '在 "todo-title" 中按回车', ja: '"todo-title" でエンターキーを押す', en: 'I press enter in "todo-title"' },
    run: (app, id) => app.pressKey(s(id), 'enter'),
  },
  {
    name: 'scroll',
    expressions: { zh: '在 {string} 中向{word}滚动', ja: '{string} を{word}にスクロールする', en: 'I scroll {string} {word}' },
    examples: { zh: '在 "todo-list" 中向下滚动', ja: '"todo-list" を下にスクロールする', en: 'I scroll "todo-list" down' },
    run: (app, id, dir) => app.scroll(s(id), word('direction', DIRECTIONS, dir)),
  },
  {
    name: 'scrollToEdge',
    expressions: { zh: '把 {string} 滚动到{word}', ja: '{string} を{word}までスクロールする', en: 'I scroll {string} to the {word}' },
    examples: { zh: '把 "todo-list" 滚动到底部', ja: '"todo-list" を一番下までスクロールする', en: 'I scroll "todo-list" to the bottom' },
    run: (app, id, edge) => app.scrollToEdge(s(id), word('edge', EDGES, edge)),
  },
  {
    name: 'swipe',
    expressions: { zh: '在 {string} 上向{word}滑动', ja: '{string} を{word}にスワイプする', en: 'I swipe {word} on {string}' },
    examples: { zh: '在 "todo-item" 上向左滑动', ja: '"todo-item" を左にスワイプする', en: 'I swipe left on "todo-item"' },
    // en names the direction first: run(target, direction)
    order: { en: [1, 0] },
    run: (app, id, dir) => app.swipe(s(id), word('direction', DIRECTIONS, dir)),
  },
  {
    name: 'drag',
    expressions: { zh: '把 {string} 拖到 {string}', ja: '{string} を {string} までドラッグする', en: 'I drag {string} to {string}' },
    examples: { zh: '把 "item-1" 拖到 "item-3"', ja: '"item-1" を "item-3" までドラッグする', en: 'I drag "item-1" to "item-3"' },
    run: (app, from, to) => app.drag(s(from), s(to)),
  },
  {
    name: 'pinch',
    expressions: { zh: '在 {string} 上双指缩放到 {float} 倍', ja: '{string} を {float} 倍にピンチする', en: 'I pinch {string} to {float} times' },
    examples: { zh: '在 "photo" 上双指缩放到 2 倍', ja: '"photo" を 2 倍にピンチする', en: 'I pinch "photo" to 2 times' },
    run: (app, id, scale) => app.pinch(s(id), Number(scale)),
  },
  // ---- Phase 6.3: value controls ----
  {
    name: 'setSlider',
    expressions: { zh: '把滑块 {string} 设为 {float}', ja: 'スライダー {string} を {float} にする', en: 'I set the slider {string} to {float}' },
    examples: { zh: '把滑块 "volume" 设为 30', ja: 'スライダー "volume" を 30 にする', en: 'I set the slider "volume" to 30' },
    run: (app, id, value) => app.setValue(s(id), Number(value)),
  },
  {
    name: 'switchOn',
    expressions: { zh: '打开开关 {string}', ja: 'スイッチ {string} をオンにする', en: 'I turn on the switch {string}' },
    examples: { zh: '打开开关 "notify"', ja: 'スイッチ "notify" をオンにする', en: 'I turn on the switch "notify"' },
    run: (app, id) => app.setValue(s(id), true),
  },
  {
    name: 'switchOff',
    expressions: { zh: '关闭开关 {string}', ja: 'スイッチ {string} をオフにする', en: 'I turn off the switch {string}' },
    examples: { zh: '关闭开关 "notify"', ja: 'スイッチ "notify" をオフにする', en: 'I turn off the switch "notify"' },
    run: (app, id) => app.setValue(s(id), false),
  },
  {
    name: 'select',
    expressions: { zh: '在 {string} 中选择 {string}', ja: '{string} で {string} を選ぶ', en: 'I select {string} in {string}' },
    examples: { zh: '在 "priority" 中选择 "高"', ja: '"priority" で "高" を選ぶ', en: 'I select "High" in "priority"' },
    // en names the option first: run(target, option)
    order: { en: [1, 0] },
    run: (app, id, option) => app.setValue(s(id), s(option)),
  },
  // ---- Phase 6.1: state assertions ----
  {
    name: 'enabled',
    expressions: { zh: '元素 {string} 可用', ja: '要素 {string} が有効である', en: 'the element {string} is enabled' },
    examples: { zh: '元素 "save" 可用', ja: '要素 "save" が有効である', en: 'the element "save" is enabled' },
    run: (app, id) => app.expectEnabled(s(id)),
  },
  {
    name: 'disabled',
    expressions: { zh: '元素 {string} 不可用', ja: '要素 {string} が無効である', en: 'the element {string} is disabled' },
    examples: { zh: '元素 "save" 不可用', ja: '要素 "save" が無効である', en: 'the element "save" is disabled' },
    run: (app, id) => app.expectDisabled(s(id)),
  },
  {
    name: 'checked',
    expressions: { zh: '元素 {string} 已选中', ja: '要素 {string} がオンである', en: 'the element {string} is checked' },
    examples: { zh: '元素 "notify" 已选中', ja: '要素 "notify" がオンである', en: 'the element "notify" is checked' },
    run: (app, id) => app.expectChecked(s(id)),
  },
  {
    name: 'notChecked',
    expressions: { zh: '元素 {string} 未选中', ja: '要素 {string} がオフである', en: 'the element {string} is not checked' },
    examples: { zh: '元素 "notify" 未选中', ja: '要素 "notify" がオフである', en: 'the element "notify" is not checked' },
    run: (app, id) => app.expectNotChecked(s(id)),
  },
  {
    name: 'focused',
    expressions: { zh: '元素 {string} 获得焦点', ja: '要素 {string} にフォーカスがある', en: 'the element {string} has the focus' },
    examples: { zh: '元素 "todo-title" 获得焦点', ja: '要素 "todo-title" にフォーカスがある', en: 'the element "todo-title" has the focus' },
    run: (app, id) => app.expectFocused(s(id)),
  },
  {
    name: 'hasValue',
    expressions: { zh: '元素 {string} 的值是 {string}', ja: '要素 {string} の値が {string} である', en: 'the element {string} has the value {string}' },
    examples: { zh: '元素 "priority" 的值是 "high"', ja: '要素 "priority" の値が "high" である', en: 'the element "priority" has the value "high"' },
    run: (app, id, value) => app.expectValue(s(id), s(value)),
  },
  {
    name: 'sliderValue',
    expressions: { zh: '滑块 {string} 的值是 {float}', ja: 'スライダー {string} の値が {float} である', en: 'the slider {string} has the value {float}' },
    examples: { zh: '滑块 "volume" 的值是 30', ja: 'スライダー "volume" の値が 30 である', en: 'the slider "volume" has the value 30' },
    run: (app, id, value) => app.expectValue(s(id), Number(value)),
  },
  // ---- Phase 6.5: app lifecycle ----
  {
    name: 'background',
    expressions: { zh: '把 App 切到后台', ja: 'アプリをバックグラウンドにする', en: 'I send the app to the background' },
    examples: { zh: '把 App 切到后台', ja: 'アプリをバックグラウンドにする', en: 'I send the app to the background' },
    run: (app) => app.device.sendToBackground(),
  },
  {
    name: 'foreground',
    expressions: { zh: '把 App 切回前台', ja: 'アプリをフォアグラウンドに戻す', en: 'I bring the app to the foreground' },
    examples: { zh: '把 App 切回前台', ja: 'アプリをフォアグラウンドに戻す', en: 'I bring the app to the foreground' },
    run: (app) => app.device.bringToForeground(),
  },
  {
    name: 'relaunch',
    expressions: { zh: '重新启动 App', ja: 'アプリを再起動する', en: 'I relaunch the app' },
    examples: { zh: '重新启动 App', ja: 'アプリを再起動する', en: 'I relaunch the app' },
    run: (app) => app.device.relaunch(),
  },
  // ---- Phase 6.6 / 6.7: device state and system UI ----
  {
    name: 'orientation',
    expressions: { zh: '把设备转到{word}', ja: '画面を{word}にする', en: 'I rotate the device to {word}' },
    examples: { zh: '把设备转到横屏', ja: '画面を横向きにする', en: 'I rotate the device to landscape' },
    run: (app, o) => app.device.setOrientation(word('orientation', ORIENTATIONS, o)),
  },
  {
    name: 'appearance',
    expressions: { zh: '把外观设为{word}模式', ja: '外観を{word}モードにする', en: 'I switch to {word} mode' },
    examples: { zh: '把外观设为深色模式', ja: '外観をダークモードにする', en: 'I switch to dark mode' },
    run: (app, a) => app.device.setAppearance(word('appearance', APPEARANCES, a)),
  },
  {
    name: 'location',
    expressions: { zh: '把设备位置设为 {float}, {float}', ja: '端末の位置を {float}, {float} にする', en: 'I set the device location to {float}, {float}' },
    examples: { zh: '把设备位置设为 35.68, 139.76', ja: '端末の位置を 35.68, 139.76 にする', en: 'I set the device location to 35.68, 139.76' },
    run: (app, lat, lon) => app.device.setLocation(Number(lat), Number(lon)),
  },
  {
    name: 'offline',
    expressions: { zh: '把设备切换到离线', ja: '端末をオフラインにする', en: 'I go offline' },
    examples: { zh: '把设备切换到离线', ja: '端末をオフラインにする', en: 'I go offline' },
    run: (app) => app.device.setNetwork('offline'),
  },
  {
    name: 'online',
    expressions: { zh: '把设备切换到在线', ja: '端末をオンラインにする', en: 'I go online' },
    examples: { zh: '把设备切换到在线', ja: '端末をオンラインにする', en: 'I go online' },
    run: (app) => app.device.setNetwork('online'),
  },
  {
    name: 'grantPermission',
    expressions: { zh: '授予 App {word}权限', ja: 'アプリに{word}の権限を与える', en: 'I grant the {word} permission' },
    examples: { zh: '授予 App 定位权限', ja: 'アプリに位置情報の権限を与える', en: 'I grant the location permission' },
    run: (app, p) => app.device.setPermission(word('permission', PERMISSIONS, p), 'grant'),
  },
  {
    name: 'revokePermission',
    expressions: { zh: '撤销 App 的{word}权限', ja: 'アプリの{word}の権限を取り消す', en: 'I revoke the {word} permission' },
    examples: { zh: '撤销 App 的定位权限', ja: 'アプリの位置情報の権限を取り消す', en: 'I revoke the location permission' },
    run: (app, p) => app.device.setPermission(word('permission', PERMISSIONS, p), 'revoke'),
  },
  {
    name: 'allowDialog',
    expressions: { zh: '在系统弹窗中允许', ja: 'システムダイアログで許可する', en: 'I allow in the system dialog' },
    examples: { zh: '在系统弹窗中允许', ja: 'システムダイアログで許可する', en: 'I allow in the system dialog' },
    run: (app) => app.device.system.allowPermission(),
  },
  {
    name: 'denyDialog',
    expressions: { zh: '在系统弹窗中拒绝', ja: 'システムダイアログで拒否する', en: 'I deny in the system dialog' },
    examples: { zh: '在系统弹窗中拒绝', ja: 'システムダイアログで拒否する', en: 'I deny in the system dialog' },
    run: (app) => app.device.system.denyPermission(),
  },
  {
    name: 'shake',
    expressions: { zh: '摇动设备', ja: '端末を振る', en: 'I shake the device' },
    examples: { zh: '摇动设备', ja: '端末を振る', en: 'I shake the device' },
    run: (app) => app.device.shake(),
  },
  // ---- Phase 6.9: evidence ----
  {
    name: 'screenshot',
    expressions: { zh: '截图并保存为 {string}', ja: 'スクリーンショットを {string} として保存する', en: 'I take a screenshot named {string}' },
    examples: { zh: '截图并保存为 "列表"', ja: 'スクリーンショットを "一覧" として保存する', en: 'I take a screenshot named "list"' },
    run: (app, name) => app.device.screenshot(undefined, { name: s(name) }),
  },
];
/** Arguments as `run` expects them, from the parameters in the order the language's expression has them. */
export function argsFor(step: GenericStep, language: Language, params: readonly (string | number)[]): (string | number)[] {
  const order = step.order?.[language];
  return order === undefined ? [...params] : order.map((i) => params[i] as string | number);
}
