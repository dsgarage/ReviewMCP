# review-mcp-min（Re:VIEW用 最小MCPサーバー）

**目的：** 執筆の手を止めずに、Re:VIEW原稿のエラーを未然に防ぐ。  
- 保存時に **許可外タグをブロック**（“勝手なタグ定義”を禁止）  
- **ID（空／重複）を自動修正**（人間可読な命名でユニーク化）  
- 迅速な **Lint**（`review-compile --target=latex`）で代表的な落とし穴を検出  
- Re:VIEW **5.8 / 2.5(ReviewStarter)** の両環境に将来的に対応可能（本雛形は5.8を前提に構成）

---

## 同梱ツール（MVP）
- `review.version` — Re:VIEW CLI バージョン取得
- `review.tags.list` — 内蔵の保守的Allowlist（後で動的プローブに置換予定）
- `review.enforceTags.check` — 許可外タグの検出（保存ブロック用）
- `review.fixIds.plan` / `review.fixIds.apply` — IDの空欄／重複の自動修正
- `review.lint` — 高速Lint（各 `.re` を latex 変換に通して stderr を解析）

> 将来拡張：`review.tags.list` を「バージョン／ターゲット依存の**動的プローブ＋キャッシュ**」に差し替えると、5.8/2.5 の**実体**に即した確定タグ一覧が返せます。

---

## 動作要件
- Node.js 18+
- Ruby / Bundler / Re:VIEW（プロジェクト側で `bundle exec review --version` が通ること）
- Re:VIEWプロジェクトに `config.yml` と `catalog.yml` が存在すること

---

## 展開方法（2つの配布形態）

### A. リリースZIPとして展開（単体配布）
1. 本リポジトリのリリースで配布する `review-mcp-min.zip` を展開  
2. `npm i`  
3. `npm run start` で MCP サーバー起動  
4. ClaudeCode から MCP サーバーに接続し、ツール呼び出し時の引数 `cwd` に **Re:VIEWプロジェクトのルート**（`config.yml`/`catalog.yml` がある場所）を渡します。

### B. Git サブモジュール運用
1. GitHub 上に本サーバー（独立リポジトリ）を作成（例：`your-org/review-mcp`）  
2. 各 Re:VIEW プロジェクトでサブモジュールとして追加：
   ```bash
   git submodule add git@github.com:your-org/review-mcp.git tools/review-mcp
   git submodule update --init --recursive
   ```
3. 実行：
   ```bash
   cd tools/review-mcp
   npm i
   npm run start
   ```
4. ClaudeCode 側からは `cwd` を **プロジェクトルート**に指定してツールを呼び出してください。

> 推奨：サブモジュールは **タグ（例：v0.1.0）** に固定し、各プロジェクトごとにバージョンを明示管理。

---

## 使い方（ClaudeCode 連携の例）

### 保存時の推奨フロー
1. `review.enforceTags.check` — 許可外タグがあれば**保存を中断**  
2. `review.fixIds.plan` → `review.fixIds.apply` — ID を**自動修正**（`.bak` を残す）  
3. `review.lint` — 代表的な注意点（例：`//' seen but is not valid command`、`duplicate ID`）を警告表示

> **保存を止めるのは“許可外タグのみ”**に限定。執筆の流れを阻害しない方針です。

### MCP ツール引数の基本
- すべてのツールで `cwd` を Re:VIEWプロジェクト直下にしてください。

---

## CI / Rake 連携（ヘッドレス実行）

### `scripts/ci-lint.mjs`
- MCP クライアント不要のヘッドレス検査スクリプトです。  
- 機能：許可外タグ検出、ID自動修正の計画／適用、快速Lint。

**使い方：**
```bash
# 診断のみ（プロジェクトルートで）
node tools/review-mcp/scripts/ci-lint.mjs --cwd .

# ID自動修正も適用
node tools/review-mcp/scripts/ci-lint.mjs --cwd . --apply-ids
```

**Rake から呼ぶ例：**
```ruby
desc 'MCP: enforce tags, fix IDs (plan), fast lint'
task 'mcp:lint' do
  sh "node tools/review-mcp/scripts/ci-lint.mjs --cwd ."
end

desc 'MCP: enforce tags, apply ID fixes, fast lint'
task 'mcp:fix' do
  sh "node tools/review-mcp/scripts/ci-lint.mjs --cwd . --apply-ids"
end
```

---

## 設定ファイル（任意） `review-mcp.json`
```json
{
  "profile": "dual",
  "target": "latex",
  "blockOnUnknownTags": true,
  "autoFixIdsOnSave": true
}
```
- `profile` は将来、`"review-5.8" | "review-2.5" | "dual"` を想定（本雛形では未使用のダミー）  
- `target` は標準 `latex`（pdfmaker 前段の検証に合わせるため）

---

## よくある質問

### Q. MCPサーバーはプロジェクト直下に置くべき？
- どちらでもOKです。**別ディレクトリで独立運用**しても、**サブディレクトリに同梱**しても動作します。  
- 重要なのは、ツール引数 `cwd` を **Re:VIEWプロジェクトのルート**にすること。

### Q. 2.5(ReviewStarter) との両対応は？
- 本雛形では **保守的Allowlist** によるガードのみ提供しています。  
- 将来的に `review.tags.list` を **動的プローブ＋キャッシュ**に差し替え、5.8/2.5 双方で“実際に通るタグ”集合を確定させます。  
- `profile: "dual"`（共通集合のみ許可）で“どちらにも通る原稿”を担保する運用を想定。

---

## 既知の限界
- タグ一覧は**内蔵の暫定集合**です（誤検出を避けるため、やや保守的）。
- LaTeX / PDFMaker 段階のすべてのエラーを保存時に拾うことはしません（執筆体験を重視）。必要に応じて CI で補完してください。

---

## 開発メモ
- `src/index.ts` の `review.tags.list` を差し替えて、動的プローブ（`review-compile` にダミー原稿を通して合否判定）＋ `cache/` 保持を実装してください。
- `cache/` は `.gitignore` 推奨（配布時は空にしてOK）。
