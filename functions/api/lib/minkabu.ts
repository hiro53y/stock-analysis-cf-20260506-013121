import type { AnalystBreakdown, AnalystConsensus } from '../../../shared/types'

/**
 * みんかぶの証券アナリスト予想ページからコンセンサスを取り出す。
 *
 * Yahoo!ファイナンスにも同種のページ（`/performance?styl=analystcons`）はあるが、使えない。
 * 公開部分の `latestRating` は 7203 と 6501 で完全に同じ値
 * （ratingAverage 0 / strongBuy 14 / buy 10 / hold 6 / sell 7 / strongSell 3）を返す
 * ログアウト時のダミーで、`ratingTrend` は6か月前のエントリだけに値が入る。
 * 6か月前の目標株価を「アナリスト目標株価」として出すと実態と大きく乖離するため採用しない。
 *
 * みんかぶ側はログイン不要・SSR済みで当日のデータが入っており、
 * 判断・平均目標株価・人数の内訳・推移が1リクエストで揃う。
 *
 * 重要な性質: ここでいう目標株価は「予想時点から**1年後**」の予想。
 * 本アプリ自身の目標（約1か月・ボラティリティ基準）とは時間軸が違うので、
 * 画面では必ず別扱いにすること。
 */

export const MINKABU_CONSENSUS_URL = (code: string) =>
  `https://minkabu.jp/stock/${code}/analyst_consensus`

/**
 * アナリストが誰もカバーしていない銘柄か。
 *
 * 小型株ではコンセンサスが存在しないことが普通にある。これを「取得できませんでした」と
 * 表示すると不具合のように見えるため、取得失敗と区別する。
 */
export function hasNoAnalystCoverage(html: string): boolean {
  return html.includes('アナリスト予想はありません')
}

function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const cleaned = raw.replace(/,/g, '').trim()
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : undefined
}

/**
 * 「強気買い10人、買い4人、中立5人」を人数へ分解する。
 *
 * 「強気買い」は「買い」を含むため、区切って先頭から完全一致で判定する
 * （部分一致で拾うと強気買いを買いとして二重計上する）。
 */
export function parseBreakdown(text: string): AnalystBreakdown | undefined {
  const breakdown: AnalystBreakdown = {}
  let matched = false

  for (const token of text.split(/[、,]/)) {
    const hit = /^\s*(強気買い|強気売り|買い|中立|売り)\s*(\d+)\s*人/.exec(token)
    if (!hit) continue
    const count = Number(hit[2])
    if (!Number.isFinite(count)) continue
    matched = true
    if (hit[1] === '強気買い') breakdown.strongBuy = count
    else if (hit[1] === '買い') breakdown.buy = count
    else if (hit[1] === '中立') breakdown.hold = count
    else if (hit[1] === '売り') breakdown.sell = count
    else if (hit[1] === '強気売り') breakdown.strongSell = count
  }

  return matched ? breakdown : undefined
}

/** 「予想株価」行の4つの値（3ヶ月前 / 1ヶ月前 / 1週間前 / 最新）を取り出す */
function parseTargetTrend(html: string): AnalystConsensus['trend'] {
  const section = /予想株価<\/th>([\s\S]{0,900}?)<\/tr>/.exec(html)
  if (!section) return undefined

  const values: number[] = []
  for (const cell of section[1].matchAll(/<td[^>]*>([\s\S]{0,80}?)<\/td>/g)) {
    const value = toNumber(cell[1].replace(/<[^>]+>/g, '').trim())
    if (value !== undefined) values.push(value)
  }
  if (values.length < 4) return undefined

  const labels = ['3ヶ月前', '1ヶ月前', '1週間前', '最新']
  return values.slice(0, 4).map((targetPrice, index) => ({ label: labels[index], targetPrice }))
}

/**
 * 「1株当り利益」行から、アナリスト予想（最新）と会社予想を取り出す。
 * 並びは 3ヶ月前 / 1ヶ月前 / 1週間前 / アナリスト最新 / 会社予想 の5つ。
 * アナリストが会社予想をどれだけ上回っている（下回っている）かは、
 * 安くなった理由が業績なのかを見るときの手がかりになる。
 */
function parseEpsComparison(
  html: string,
): { analyst?: number; company?: number } | undefined {
  const row = /1株当り利益<\/th>([\s\S]{0,700}?)<\/tr>/.exec(html)
  if (!row) return undefined

  const values: number[] = []
  for (const cell of row[1].matchAll(/<td[^>]*>([\s\S]{0,80}?)<\/td>/g)) {
    const value = toNumber(cell[1].replace(/<[^>]+>/g, '').trim())
    if (value !== undefined) values.push(value)
  }
  if (values.length < 5) return undefined

  return { analyst: values[3], company: values[4] }
}

/**
 * ページ本文の1文からコンセンサスを取り出す。
 * 例: 「2026/09/12時点における、トヨタに対する、アナリスト判断（コンセンサス）は、買い。
 *      内訳は、強気買い10人、買い4人、中立5人となっています。
 *      アナリストの平均目標株価は3,699円で、株価はあと22.00%上昇すると予想しています。」
 *
 * 取り出せない項目は undefined のままにする。推測で埋めない。
 */
export function parseAnalystConsensus(html: string): AnalystConsensus | undefined {
  const sentence =
    /(\d{4}\/\d{2}\/\d{2})時点における、[^、]*に対する、アナリスト判断（コンセンサス）は、([^。]+)。([\s\S]{0,300}?)アナリストの平均目標株価は([\d,]+)円/.exec(
      html,
    )
  if (!sentence) return undefined

  const targetPrice = toNumber(sentence[4])
  if (targetPrice === undefined) return undefined

  const upsideMatch = /株価はあと(-?[\d.]+)%上昇すると予想/.exec(html)
  const breakdownMatch = /内訳は、([^。]+)/.exec(sentence[3])

  return {
    asOf: sentence[1],
    judgement: sentence[2].trim(),
    targetPrice,
    upside: upsideMatch ? (toNumber(upsideMatch[1]) ?? 0) / 100 : undefined,
    breakdown: breakdownMatch ? parseBreakdown(breakdownMatch[1]) : undefined,
    trend: parseTargetTrend(html),
    eps: parseEpsComparison(html),
    source: 'みんかぶ',
    horizonNote: '予想時点から1年後の株価予想',
  }
}
