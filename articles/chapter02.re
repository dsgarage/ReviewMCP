= 高度な機能のテスト

== テーブル

//table[comparison][機能比較]{
機能	MCP前処理	Ruby最終出力
----------------------------
タグ検証	○	-
ID自動修正	○	-
PDF生成	-	○
LaTeX変換	-	○
//}

== 画像とキャプション

#@# //image[sample-image][サンプル画像]{
#@# //}

//note{
画像ファイルが存在しない場合はコメントアウトしています。
実際の使用時は images/ ディレクトリに画像を配置してください。
//}

== ソースコード

//source[hello.js][JavaScript Hello World]{
// MCP Hybrid Pipeline Test
function greet(name) {
  return `Hello, ${name}!`;
}

console.log(greet("MCP"));
//}

== 番号付きリスト

=== 実装手順

 1. Re:VIEWプロジェクトの初期化
 2. 設定ファイル（config.yml）の作成
 3. カタログファイル（catalog.yml）の設定
 4. 原稿ファイル（.re）の作成
 5. MCPコマンドでPDF生成

=== チェックリスト

 * @<code>{review.preprocess} - JS前処理
 * @<code>{review.build-pdf-hybrid} - ハイブリッドPDF生成
 * @<code>{review.check-ruby-extensions} - Ruby拡張確認
 * @<code>{review.test-mapfile} - mapfileテスト

== セキュリティのベストプラクティス

//note{
SSOT（Single Source of Truth）原則に従い、セキュリティ設定は一箇所で管理します。
MCPはReviewExtentionから設定を取得し、二層防御を実現します：

 1. MCP側での前段サニタイズ
 2. Ruby側での最終検証

この仕組みにより、設定の不整合を防ぎます。
//}

== フットノート

Re:VIEWは技術書執筆に特化したマークアップ言語です@<fn>{review-official}。
MCPとの統合により、より効率的な執筆環境を実現します@<fn>{mcp-integration}。

//footnote[review-official][https://reviewml.org/]
//footnote[mcp-integration][Model Context Protocolによる拡張機能]

== 数式

インライン数式: @<m>{E = mc^2}

#@# ブロック数式はLaTeXパッケージが必要

== まとめ

本書では、MCPハイブリッドパイプラインの以下の機能をテストしました：

 * 基本的なRe:VIEWタグの処理
 * セキュリティ設定のSSOT化
 * JS前処理とRuby最終出力の連携
 * PDF生成パイプライン

これらの機能により、安全で効率的な技術書執筆環境を実現できます。