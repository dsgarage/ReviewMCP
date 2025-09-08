= ハイブリッドパイプラインのテスト

== 概要

本章では、MCP（Model Context Protocol）サーバーのハイブリッドパイプライン機能をテストします。
JavaScriptによる前処理とRubyによる最終出力を組み合わせた@<b>{統合パイプライン}の動作を確認します。

== 基本的なタグのテスト

=== インラインタグ

以下は@<strong>{強調}、@<em>{イタリック}、@<code>{inline code}の例です。
また、@<tt>{等幅フォント}や@<u>{下線}も使用できます。

キーワード: @<kw>{Re:VIEW, MCP}
キー入力: @<tt>{Ctrl+C}

=== ブロックタグ

//list[sample-code][サンプルコード]{
function hello() {
  console.log("Hello, MCP!");
}
//}

//emlist[番号なしリスト]{
const config = {
  source: "reviewextention",
  maxFileSize: 1048576
};
//}

== セキュリティ機能のテスト

//note{
SSOTセキュリティ設定により、ReviewExtentionから設定を動的に取得します。
ハードコードされた値は使用しません。
//}

//memo{
mapfileマクロのパスバリデーション機能により、
危険なパストラバーサルや絶対パスの使用を防ぎます。
//}

== コマンドラインの例

//cmd{
$ npm run build
$ review-pdfmaker -c config.yml
//}

== 引用

//quote{
優れたソフトウェアは、単純さと明快さから生まれる。
複雑さは敵である。
//}

== まとめ

本章では、以下の機能をテストしました：

 * インラインタグの動作
 * ブロックタグの処理
 * セキュリティ設定の適用
 * コマンドラインの表示

次章では、より高度な機能について説明します。