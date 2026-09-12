import { canonicalCode } from './utils'

/**
 * 銘柄コードから、その銘柄を扱う外部サイトのURLを組み立てる。
 *
 * アナリスト評価の大半（楽天証券・SBI証券・moomoo など）はログイン領域にあり、
 * サーバーからは取得できない。ただし利用者のブラウザは多くの場合ログイン済みなので、
 * 該当銘柄のページへ直接飛べるようにしておけば、会員向けの評価をそのまま見られる。
 * 取り込みの代わりとして、これが現実的にいちばん役に立つ。
 */

export interface ExternalStockLink {
  id: string
  label: string
  url: string
  /** リンク先で主に何が見られるか（画面の補足に使う） */
  hint: string
}

/** 4桁の日本株コードだけを対象にする。取り出せなければ null。 */
function toJapaneseCode(code: string): string | null {
  const canonical = canonicalCode(code)
  const match = /^(\d{4})\.T$/.exec(canonical)
  return match ? match[1] : null
}

/**
 * 対象銘柄の外部サイトURL一覧。日本株でなければ空配列。
 * `7203` でも `7203.T` でも同じ結果を返す。
 */
export function buildExternalLinks(code: string): ExternalStockLink[] {
  const jp = toJapaneseCode(code)
  if (!jp) return []

  return [
    {
      id: 'yahoo',
      label: 'Yahoo!ファイナンス',
      url: `https://finance.yahoo.co.jp/quote/${jp}.T`,
      hint: '株価・指標・決算',
    },
    {
      id: 'minkabu',
      label: 'みんかぶ',
      url: `https://minkabu.jp/stock/${jp}`,
      hint: 'アナリスト予想・個人予想',
    },
    {
      id: 'kabutan',
      label: '株探',
      url: `https://kabutan.jp/stock/?code=${jp}`,
      hint: 'ニュース・材料',
    },
    {
      id: 'rakuten',
      label: '楽天証券',
      url: `https://www.rakuten-sec.co.jp/web/market/search/quote.html?ric=${jp}.T`,
      hint: 'レポート（要ログイン）',
    },
    {
      id: 'sbi',
      label: 'SBI証券',
      url:
        'https://site1.sbisec.co.jp/ETGate/?_ControlID=WPLETsiR001Control' +
        `&_DataStoreID=DSWPLETsiR001Control&s_rkbn=2&i_stock_sec=${jp}`,
      hint: 'レポート（要ログイン）',
    },
    {
      id: 'moomoo',
      label: 'moomoo',
      url: `https://www.moomoo.com/ja/stock/${jp}-JP`,
      hint: 'アナリスト評価',
    },
  ]
}
