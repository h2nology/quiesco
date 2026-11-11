# language: ja
機能: 汎用ステップ（日本語）
  サンプルアプリを @quiesco/steps の日本語ステップで操作する。

  シナリオ: 値コントロールと状態の確認
    前提 通过后门 "openControls" 打开页面 "controls"
    もし スライダー "volume" を 35 にする
    ならば 要素 "volume-value" のテキストが "35" である
    もし スイッチ "notify" をオンにする
    ならば 要素 "notify" がオンである
    もし "fruit" で "榴莲" を選ぶ
    ならば 要素 "fruit-value" のテキストが "fruit-3" である

  シナリオ: ログインしてエンターキーで登録する
    もし "email" に "ja@example.com" と入力する
    かつ "password" に "secret" と入力する
    かつ "login-button" をタップする
    ならば 要素 "greeting" のテキストが "ja@example.com" である
    もし "add-todo" をタップする
    かつ "todo-title" に "牛乳を買う" と入力する
    かつ "todo-title" でエンターキーを押す
    ならば 要素 "todo-item" が 1 個ある

  シナリオ: 外観と画面の向き
    前提 通过后门 "openDevice" 打开页面 "device"
    もし 外観をダークモードにする
    ならば 要素 "color-scheme" のテキストが "dark" である
    もし 画面を横向きにする
    ならば 要素 "orientation" のテキストが "landscape" である
