# Re:VIEW執筆をゼロから開始するためのセットアップ手順（ClaudeCode + MCP + サブモジュール）

**対象読者**: Re:VIEW原稿をClaudeCodeで執筆する開発者・著者  
**オーナー**: @dsgarage  
**バージョン**: v1.0

## 概要

### ゴール
- 空のGitリポジトリから開始し、Re:VIEWの現行バージョンで初期化
- MCPサーバー（review-mcp）をサブモジュール導入
- ClaudeCode/Claude Desktop側のMCP設定
- 保存時に未知タグブロック・ID自動修正・高速Lintが動く状態で、即執筆開始

### 成果物
- `config.yml` / `catalog.yml` が存在するRe:VIEWプロジェクト
- `tools/review-mcp` サブモジュールでMCP常駐
- Claude側からMCPツールが呼べる

## 前提条件

### 必要なツール
- Node.js 18+
- Ruby + Bundler
- Re:VIEW（プロジェクト側で `bundle exec review --version` が通る）
- Git / GitHub（サブモジュール参照用）

### 確認コマンド
```bash
ruby -v
bundle -v
bundle exec review --version
node -v
```

### 注意事項
- Re:VIEW 2.5(ReviewStarter)併用は将来対応。まずは5.8基準で運用開始。
- macOSでの運用を想定。

## リポジトリ構造の参考
```
mybook/                 # ← プロジェクトルート（cwd）
├── config.yml
├── catalog.yml
├── ch01.re
├── images/
└── tools/
    └── review-mcp/     # サブモジュール
```

## セットアップ手順

### 1. 空のリポジトリを作成
```bash
mkdir mybook
cd mybook
git init
```

### 2. MCPサーバーをサブモジュールとして追加
```bash
git submodule add git@github.com:<your-org-or-user>/review-mcp.git tools/review-mcp
git submodule update --init --recursive
```
**Tips**: サブモジュールはタグ固定運用推奨（例：v0.1.0）。

### 3. Re:VIEWプロジェクトを現行バージョンで初期化
現時点でインストール済みのRe:VIEWのバージョンに合わせて初期化する。
```bash
bundle init -g || true
bundle add review
bundle exec review --version
bundle exec review-init .
```
**出力**: config.yml / catalog.yml / Rakefile / サンプル .re が作成される

### 4. MCPサーバー（サブモジュール）の依存を導入・起動
```bash
cd tools/review-mcp
npm i
npm run start
```
**注意**: 
- このプロセスは常駐（ターミナルを開いたままにする）。
- 別シェルで執筆作業を続ける。

### 5. Claude Desktop 側のMCP設定（方法A）
設定ファイル `~/Library/Application Support/Claude/claude_desktop_config.json` にreview-mcpを追記：
```json
{
  "mcpServers": {
    "review-mcp": {
      "command": "node",
      "args": [
        "/Users/<YOUR_NAME>/mybook/tools/review-mcp/node_modules/.bin/tsx",
        "/Users/<YOUR_NAME>/mybook/tools/review-mcp/src/index.ts"
      ]
    }
  }
}
```
**アクション**:
- Claude Desktopを再起動
- ツール一覧に review-mcp が表示されることを確認
- ログは `~/Library/Logs/Claude/mcp*.log` を参照

### 6. ClaudeCode(VS Code拡張)でのMCP登録（方法B）
```bash
cd ~/mybook
claude mcp add review-mcp -s project -- \
  node ./tools/review-mcp/node_modules/.bin/tsx ./tools/review-mcp/src/index.ts
```
**注意**: `-s` はスコープ：project / local / user。まずは local で検証→project固定がおすすめ。

### 7. 執筆開始（cwd前提の確認）
以降は **プロジェクトルート(=cwd)** で作業する。
`config.yml` と `catalog.yml` がある場所に `cd` した状態でコマンドを実行。
```bash
cd ~/mybook
# 例: ヘッドレスチェック（CI/Rakeからも同じ）
node tools/review-mcp/scripts/ci-lint.mjs --cwd .
```
**注意**: 普段プロジェクト直下で作業するなら `--cwd .` で十分。今後は省略自動解釈にも拡張可能。

## 保存時のワークフロー

ClaudeCode の保存フックで呼ぶ推奨順序：

1. **review.enforceTags.check**: 許可外タグがあれば保存ブロック（"勝手なタグ定義"防止）
2. **review.fixIds.plan → review.fixIds.apply**: 空/重複IDを自動修正（.bak作成）
3. **review.lint**: 代表的な警告のみ表示（執筆は止めない）

## CLIショートカット

### ヘッドレスチェック
- **診断のみ**: `node tools/review-mcp/scripts/ci-lint.mjs --cwd .`
- **ID自動修正も適用**: `node tools/review-mcp/scripts/ci-lint.mjs --cwd . --apply-ids`

## 設定ファイル

### review-mcp.json の例
```json
{
  "profile": "dual",
  "target": "latex",
  "blockOnUnknownTags": true,
  "autoFixIdsOnSave": true
}
```
**注意**: 将来：review-5.8 / review-2.5 / dual のプロファイル切替、動的タグプローブ＋キャッシュを追加予定。

## 動作確認

### チェック項目
- Claudeのツール一覧に review-mcp が見える
- ci-lint.mjs で Unknown tags / Duplicate ID 警告が適切に出る／修正される
- 任意の .re で保存時に未知タグがブロックされる

## FAQ

**Q: cwd はどこを指す？**  
A: `config.yml` と `catalog.yml` がある **プロジェクトのトップディレクトリ**。普段 `cd mybook/` してから作業なら `--cwd .` でOK。

**Q: プロジェクト外にMCPを置いて良い？**  
A: OK。サブモジュールとして `tools/review-mcp` に置くのが運用上わかりやすい。

**Q: 2.5(ReviewStarter) も使いたい**  
A: 現状は保守的Allowlistでガード。将来、タグ動的プローブで5.8/2.5を自動判別＆共通集合(`profile: dual`)の提示に対応予定。

## トラブルシューティング

### MCPがツール一覧に出ない
- Claude Desktop再起動
- 設定JSONの絶対パス・構文エラー確認
- `~/Library/Logs/Claude/mcp*.log` のエラーメッセージ確認

### ci-lintがプロジェクトを認識しない
- `--cwd` が `config.yml` / `catalog.yml` の直下を指しているか
- `catalog.yml` の `PREDEF/CHAPS/APPENDIX` にファイルが列挙されているか

### Unknown tags が多発
- 行頭 `//` の誤用（未知ブロック扱い）に注意。コメント用途は文字として `\\//` にするか、コードブロックに入れる。
- 使えるタグは保守的Allowlistで制限。必要ならサーバー側に許可タグを追加。

## 今後のステップ

### ロードマップ
- review.tags.list を"動的プローブ＋キャッシュ"へ置換（5.8/2.5/target毎の確定タグ一覧）
- `--cwd` 省略時に自動で `process.cwd()` を使用するオプション
- lintFull（pdfmaker一時BOOK）と compile（本番PDF出力）ツールの追加