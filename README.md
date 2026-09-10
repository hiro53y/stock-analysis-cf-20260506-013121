# 株式意思決定支援アプリ — Cloudflare Pages 版

日本株全体から「本日値下がりした銘柄」を集めて押し目・反発・危険に仕分けし、
気になった銘柄を個別に分析できる、スマホ対応の Web アプリです。
Android のホーム画面に追加（PWA）して利用できます。

React + TypeScript + Cloudflare Pages Functions 構成。

---

## 画面と機能

| タブ | 内容 |
|------|------|
| **候補抽出** | Yahoo!ファイナンスのランキングから日本株全体（約300銘柄）を走査し、本日値下がりした銘柄を「押し目候補 / 反発候補 / 危険な下落」に自動で仕分けして一覧表示します。 |
| **個別株調査** | 銘柄コードまたは会社名を指定して、価格推移・予測・バックテスト・判断根拠を表示します。 |
| **使用方法** | 用語と結果の見方の説明。 |

### 候補の選び方

1. **一次選抜** — 値下がり率ランキング6ページ + 出来高ランキング2ページ（計8リクエスト）から、
   銘柄コード・社名・市場区分・株価・前日比・出来高を取得します。
   当日下落していて、かつ売買代金が一定以上（＝実際に売買できる流動性がある）銘柄だけを対象にします。
2. **二次分析** — 一次選抜の上位60銘柄だけ、株価履歴（6か月）を取得します（3リクエスト）。
   移動平均・RSI・ボラティリティ・20日高安からの距離を計算し、分類とスコアを出します。

この二段構えは Cloudflare Workers の subrequest 上限（無料プランで1リクエストあたり50）に収めるためです。
全銘柄に履歴を取りにいくと上限を超え、キャッシュが切れるたびに 502 になります。
`functions/api/candidates.test.ts` が上限内であることを検証しています。

### 分類のルール

利用者に言葉で説明できる条件だけで分類します（スコアの閾値では仕分けません）。

| 分類 | 条件 |
|------|------|
| **危険な下落** | 下落継続リスクが高い、または5日で-7%以上下げて20日安値を更新中 |
| **押し目候補** | 当日下落 かつ 5日線が20日線を上回り、20日騰落も崩れていない |
| **反発候補** | 当日下落 かつ 20日騰落がマイナス（調整局面）で RSI14 が45以下（売られすぎ圏） |
| **見送り** | 上記以外。原則表示しません（登録銘柄のみ表示） |

### 目標株価と損切り水準

固定の「+10%」は使いません。その銘柄自身の直近20日のボラティリティから
5営業日の想定変動幅 σ を求め、目標 = +1.5σ、損切り = -1.0σ とします。
値動きの小さい大型株と荒い小型株に同じ目標を置いても判断材料にならないためです。

### 過去の同条件の実績

各候補について、**同じ銘柄の過去6か月**で同じ分類条件が成立した日を探し、
その5営業日後に上昇していた割合と平均リターンを表示します。
外部データの追加取得は不要です（履歴取得済みのため）。
標本が5件未満のときは表示しません。過去の傾向であって、将来を保証するものではありません。

---

## フォルダ構成

```
stock-analysis-cf-20260506-013121/
├── functions/api/                Cloudflare Pages Functions（バックエンド API）
│   ├── candidates.ts             GET  /api/candidates       候補一覧
│   ├── analyses.ts               POST /api/analyses         個別分析の実行
│   ├── analyses/[id].ts          GET  /api/analyses/:id     実行状態の取得
│   ├── market-data/[symbol].ts   GET  /api/market-data/:symbol
│   ├── search.ts                 GET  /api/search           銘柄検索
│   ├── healthz.ts                GET  /api/healthz
│   └── lib/
│       ├── jp-ranking.ts         ランキングHTMLの解析（一次選抜）
│       ├── market-data.ts        Yahoo Finance 取得とキャッシュ
│       ├── subrequest-budget.ts  subrequest 上限の自己管理
│       ├── store.ts              KV アクセス
│       └── rate-limit.ts         簡易レート制限
├── shared/                       フロント・バックエンド共有コード
│   ├── analysis/candidates.ts    分類・スコア・簡易バックテスト
│   ├── analysis/targets.ts       単元株コストと目標・損切り水準
│   └── constants.ts              しきい値と設定値（変更点はここに集約）
├── src/                          React フロントエンド
│   ├── hooks/useAnalysis.ts      個別分析の状態機械
│   └── components/               画面部品
├── public/                       PWA manifest, sw.js, _headers
├── wrangler.toml                 Cloudflare 設定（KV バインディング）
├── _VERIFY.md                    検証記録
└── package.json
```

---

## セットアップ

### 前提
- Node.js 18 以上
- Cloudflare アカウント（無料プラン可）

### インストールとローカル起動

```bash
npm install
npm run dev:full
```

`npm run dev:full` はビルドしてから Cloudflare Pages のローカルサーバを起動します。
ブラウザで `http://localhost:8788` を開いてください。

### KV Namespace（新しく作る場合のみ）

`wrangler.toml` には既存の Namespace ID が設定済みです。新規に作る場合のみ以下を実行します。

```bash
npx wrangler kv namespace create "ANALYSIS_KV"
npx wrangler kv namespace create "ANALYSIS_KV" --preview
```

出力された `id` / `preview_id` を `wrangler.toml` に記入してください。

---

## デプロイ

### 方法 A：GitHub 連携（このプロジェクトで使っている方法）

このフォルダ自体が GitHub リポジトリです。変更を push すると Cloudflare Pages が自動でビルド・公開します。

| 項目 | 値 |
|------|-----|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Cloudflare Pages プロジェクト名 | `stock-analysis-cf-20260506-013121` |

### 方法 B：CLI から直接デプロイ

```bash
npm run build
npm run deploy
```

`wrangler.toml` の `name` が実プロジェクト名と一致している必要があります
（食い違うと別プロジェクトが新規作成されてしまいます）。

---

## UI を変更したときの注意

`public/sw.js` の `CACHE_NAME` を必ず上げてください。上げないと利用者の端末に
旧ビルドの app shell が残り、変更が反映されません。
`shared/constants.ts` の `CACHE_VERSION` も対で更新します。

---

## 検証

```bash
npm run check   # lint → test → build
```

デプロイ後の確認項目は `_VERIFY.md` を参照してください。

---

## 制約

- Cloudflare Workers は Node.js の `fs` / `path` を使えません。ストレージは KV のみです。
- バックグラウンド処理はありません。個別分析は同期実行です。
- レート制限は KV の読み取り→加算→書き戻しで実装しており、厳密ではありません
  （同時アクセス時は緩む方向に倒れます）。厳密に止める場合は Cloudflare の Rate Limiting ルールを使ってください。
- 株価データは Yahoo Finance の公開エンドポイントに依存しています。仕様変更で動かなくなる可能性があります。

---

## 免責

このアプリは投資助言ではありません。売買判断の前に、決算、適時開示、出来高、地合い、損切り条件を必ず確認してください。
