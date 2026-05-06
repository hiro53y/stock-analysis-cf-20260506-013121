# 株式意思決定支援アプリ — Cloudflare Pages 版

React + TypeScript + Cloudflare Pages Functions で構成したスマホ対応の株価分析 Web アプリです。
Android のホーム画面に追加（PWA）して利用できます。

---

## フォルダ構成

```
stock-analysis-cf-20260506-013121/
├── functions/api/          ← Cloudflare Pages Functions（バックエンド API）
│   ├── analyses.ts         POST /api/analyses
│   ├── analyses/[id].ts    GET  /api/analyses/:id
│   ├── market-data/[symbol].ts  GET /api/market-data/:symbol
│   ├── healthz.ts          GET  /api/healthz
│   └── lib/                共通ロジック（store, worker, market-data, etc.）
├── shared/                 フロント・バックエンド共有コード
├── src/                    React フロントエンド
├── public/                 静的ファイル（PWA manifest, sw.js, _redirects, _headers）
├── dist/                   ビルド済みフロントエンド（GitHub 連携時は不要）
├── wrangler.toml           Cloudflare 設定（KV Namespace ID を記入してください）
└── package.json
```

---

## セットアップ手順（初回のみ）

### 前提
- Node.js 18 以上
- Cloudflare アカウント（無料プラン可）
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) インストール済み

```bash
npm install -g wrangler
wrangler login
```

### 1. KV Namespace を作成する

```bash
# 本番用
npx wrangler kv namespace create "ANALYSIS_KV"
# プレビュー用（ローカル開発で使用）
npx wrangler kv namespace create "ANALYSIS_KV" --preview
```

コマンドの出力に表示された `id` と `preview_id` を `wrangler.toml` の該当箇所に記入します。

```toml
[[kv_namespaces]]
binding = "ANALYSIS_KV"
id = "ここに本番KV IDを貼り付け"
preview_id = "ここにプレビューKV IDを貼り付け"
```

### 2. 依存パッケージをインストール

```bash
npm install
```

### 3. ローカルで動作確認

```bash
# フロントエンドをビルドしてから CF Pages ローカルサーバを起動
npm run dev:full
```

ブラウザで `http://localhost:8788` を開きます。

---

## Cloudflare Pages へのデプロイ

### 方法 A：GitHub 連携（推奨）

1. このフォルダを GitHub リポジトリにプッシュします。
2. [Cloudflare Dashboard](https://dash.cloudflare.com/) → Pages → 「Create a project」
3. GitHub リポジトリを選択し、以下のビルド設定を入力します。

   | 項目 | 値 |
   |------|-----|
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | `/`（デフォルト） |

4. 「Environment variables」は不要（KV は wrangler.toml のバインディングで管理）
5. 「Save and Deploy」をクリック

デプロイ後、Cloudflare Dashboard → Pages → プロジェクト → Settings → Functions → KV namespace bindings から `ANALYSIS_KV` が紐付いていることを確認してください。

### 方法 B：CLI から直接デプロイ

```bash
npm run build
npm run deploy
```

---

## 動作確認チェックリスト

デプロイ後、以下を確認してください。

- [ ] `https://あなたのサイト.pages.dev/api/healthz` が `{"ok":true,...}` を返す
- [ ] `https://あなたのサイト.pages.dev/api/market-data/7203` が株価データを返す
- [ ] トップページで銘柄コードを入力して「分析開始」→ 結果が表示される
- [ ] Android Chrome でトップページを開き「ホーム画面に追加」できる

---

## Netlify 版との主な違い

| 項目 | Netlify 版 | Cloudflare 版 |
|------|-----------|---------------|
| Functions ランタイム | Node.js | Cloudflare Workers（V8 Isolates） |
| ストレージ | Netlify Blobs + filesystem | Cloudflare KV |
| 非同期バックグラウンド処理 | Background Functions（有効時） | なし（同期実行のみ） |
| ルーティング設定 | netlify.toml | functions/ ディレクトリ構造 + _redirects |
| ローカル開発ツール | netlify dev | wrangler pages dev |

> **注意：** Cloudflare Workers は Node.js の `fs` / `path` などのモジュールを使えません。  
> store.ts は KV API のみを使うよう実装済みです。

---

## ファイル別変更点まとめ

- `functions/api/lib/store.ts` — Netlify Blobs を Cloudflare KV に置き換え
- `functions/api/lib/rate-limit.ts` — `env` を引数で受け取る形に変更
- `functions/api/lib/worker.ts` — `env` を引数で受け取る形に変更
- `functions/api/analyses.ts` — Background Function 呼び出しを削除し常に同期実行
- `functions/api/analyses/[id].ts` — CF Pages の `params.id` でルートパラメータを取得
- `functions/api/market-data/[symbol].ts` — CF Pages の `params.symbol` でルートパラメータを取得
- `functions/api/healthz.ts` — CF 向け環境情報に変更
- `wrangler.toml` — Netlify.toml の代替（KV バインディング設定）
- `public/_redirects` — SPA フォールバック（CF Pages 形式）
- `public/_headers` — キャッシュ制御（CF Pages 形式）
- `shared/constants.ts` — `CACHE_VERSION` を `cf-2026-05-v1` に更新
