# 検証記録

## 検証日時
2026-09-10 (JST)

## 検証環境
- Windows 11 / Node.js（このフォルダ内の `node_modules` を使用）
- Cloudflare Pages Functions ローカル実行: `wrangler pages dev dist`
- ブラウザ: Chromium 系（スマホ幅 375px エミュレーション）

## 起動コマンド

```bash
npm install
npm run build
npx wrangler pages dev dist --compatibility-date=2024-09-23 --ip 127.0.0.1 --port 8788
```

ブラウザで `http://127.0.0.1:8788/` を開く。

## 確認した動作

### 自動チェック
- [x] `npm run lint` 成功（エラー・警告なし）
- [x] `npm run test` 成功（6 ファイル / 53 テスト）
- [x] `npm run build` 成功（500kB 超のチャンク警告なし。最大 charts 370kB）

### API（ローカル実運用データ）
- [x] `GET /api/healthz` → 200、`kvAvailable: true`
- [x] `GET /api/candidates` → 200。走査 329 銘柄 / 本日値下がり 271 銘柄 / 詳細分析 54 銘柄
- [x] `GET /api/candidates` 2回目はキャッシュから返り、外部取得ゼロ
- [x] `POST /api/analyses`（7203 / JP）→ 202、`companyName: "トヨタ自動車"`
- [x] `POST /api/analyses`（6501 / JP）→ 202、`companyName: "日立製作所"`
- [x] `GET /api/market-data/7203?market=JP` → 200
- [x] `GET /api/search?q=任天堂` → 200、`7974.T 任天堂 東証`

### 今回修正した不具合の回帰確認
- [x] **候補抽出の 502**: 冷キャッシュでの外部取得は ランキング8回 + spark 3回 = 11回。
      subrequest 換算 33 で Cloudflare 無料プラン上限 50 の内側。テストで上限を固定（`functions/api/candidates.test.ts`）
- [x] **当日プラスの銘柄が押し目候補に出る**: 候補の当日騰落率がすべてマイナスであることを実データで確認（登録銘柄を除く）
- [x] **架空の市場ニュース**: `SAMPLE_MARKET_NEWS` と `MarketNews.tsx` を削除。
      代わりに実データの集計（走査数・値下がり数・平均下落率・分析数）を表示
- [x] **スマホでスクロールすると白紙化**: `backdrop-filter` を全廃（該当要素 0 件）。
      `:root` に単色背景 + `background-attachment: fixed` を指定し、スクロール後も背景が維持されることを確認
- [x] **ページが縦に長すぎる**: 候補一覧のページ高が 13,306px → **2,305px**（16画面分 → 2.8画面分）
- [x] **買えない株数の提示**: 1単元（100株）の必要資金表示に変更（例: 3,812円 → 38万円）
- [x] **会社名が「7203.T」と表示される**: 社名で表示されることを確認
- [x] **未実行なのに completed バッジ + 100%**: 「未実行」表示になり、進捗バー自体が出ないことを確認
- [x] **横スクロール**: 候補抽出タブ・個別株調査タブとも `scrollWidth == clientWidth`

### 表示・操作
- [x] スマホ幅 375px でタイトルが 1 行に収まる
- [x] 候補カードは既定で 1 行（高さ 61px）、タップで詳細が開く
- [x] 絞り込みチップがスクロール中も上端に固定される
- [x] タブに `role="tab"` / `aria-selected` が付き、キーボードでも操作できる
- [x] 押し目・反発・危険の 3 カテゴリすべてに候補が出る（実データで 10 / 5 / 10 件）
- [x] 候補ごとに理由の文言が異なる（テンプレートの使い回しではない）
- [x] 過去の同条件の実績（勝率・平均リターン）が表示される

## 既知の問題

- **Service Worker の登録がローカルプレビューで失敗する。**
  `dist/sw.js` は 200 / `application/javascript` で配信され、構文チェック（`node --check`）も通るため、
  検証に使ったブラウザペインの制約と考えている。**本番 https 環境での登録確認は未実施。**
- **Android 実機での PWA インストール確認は未実施。**
- **本番 Cloudflare Pages での確認は未実施**（GitHub へアップロード後に実施する）。
  特に、実運用のアクセス下で `/api/candidates` が 502 を出さないことは本番で再確認が必要。
- **レート制限は厳密ではない。** KV の読み取り→加算→書き戻しの間に割り込みが入ると計数が漏れ、
  同一 IP の同時アクセスでは上限を超えて通ることがある（緩む方向に倒れる設計）。
  厳密に止める必要が出たら Cloudflare 側の Rate Limiting ルールを使う。
- **簡易バックテストの標本は最大でも 6 か月分。** 標本 5 件未満のときは実績を表示しない。
  過去にそうだったというだけで、将来を保証するものではない。
- **`preview_id` が本番 KV と同じ namespace を指している。** プレビュー実行が本番のキャッシュに書き込む。

## 検証者
Claude (Opus 5) / Claude Code
