import { MARKET_DATA_CACHE_TTL_SECONDS } from '../../../shared/constants'
import type { MarketSegment } from '../../../shared/types'
import { fetchCachedText } from './market-data'
import { isBudgetExhausted, type SubrequestBudget } from './subrequest-budget'

/**
 * ランキング表 1 行から取れる当日の実績値。
 *
 * 以前はコードと社名だけを取り出し、株価・騰落率は spark で取り直していた。
 * その結果 300 銘柄分の spark が必要になり、Cloudflare の subrequest 上限を超えて
 * キャッシュ切れのたびに 502 になっていた。ここで数値まで取り切ることで、
 * 履歴が要る銘柄だけに spark を絞れる。
 */
export interface RankingRow {
  /** 正準シンボル（例: 7203.T） */
  code: string
  name: string
  segment: MarketSegment
  /** 当日終値（円） */
  close: number
  /** 当日騰落率（比率。-0.0252 = -2.52%） */
  return1d: number
  /** 当日出来高（株） */
  volume: number
}

type RankingCategory = 'down' | 'volume'

// ETF/ETN/指数連動などの非・個別株を社名から除外する。
// 注意: 「ブル」「ベア」等の裸のカタカナは正規銘柄（ブルボン/ダブル・スコープ/ブルーイノベーション等）に
// 誤爆するため使わない。ETF は「上場投信/ETF/レバレッジ/インバース/日経/TOPIX」で十分に捕捉できる。
const NON_STOCK_PATTERN =
  /ETF|ETN|上場投信|投信|日経|ＴＯＰＩＸ|TOPIX|レバレッジ|インバース|ＲＥＩＴ|REIT|リート/i

const SEGMENT_BY_MARKET_LABEL: Array<[RegExp, MarketSegment]> = [
  [/東証PRM|東証プライム/i, 'プライム'],
  [/東証STD|東証スタンダード/i, 'スタンダード'],
  [/東証GRT|東証グロース/i, 'グロース'],
]

// 会社名に現れうる基本的な HTML エンティティのみを復元する
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/** タグを除いた可読テキストにする（セル内の数値・単位を拾うため） */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
}

/** "1,467" や "-19.66" のような数値をすべて拾う。取得できなければ空配列。 */
function extractNumbers(text: string): number[] {
  const matches = text.match(/[+-]?[\d,]+(?:\.\d+)?/g)
  if (!matches) return []
  return matches
    .map((raw) => Number(raw.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value))
}

function toSegment(supplements: string[]): MarketSegment {
  for (const supplement of supplements) {
    for (const [pattern, segment] of SEGMENT_BY_MARKET_LABEL) {
      if (pattern.test(supplement)) return segment
    }
  }
  return 'その他'
}

/**
 * ランキング表の HTML から 1 ページ分の行を取り出す。
 *
 * 列構成（値下がり率・出来高いずれも同じ）:
 *   td[0] 社名 / コード / 市場区分, td[1] 取引値 / 日付, td[2] 前日比 / 前日比率, td[3] 出来高
 */
export function parseRankingRows(html: string): RankingRow[] {
  const rows: RankingRow[] = []
  const rowPattern = /<tr class="RankingTable__row[^"]*">([\s\S]*?)<\/tr>/g

  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const rowHtml = rowMatch[1]

    const linkMatch = /quote\/(\d{4})\.T"[^>]*>([^<]+)<\/a>/.exec(rowHtml)
    if (!linkMatch) continue

    const code = `${linkMatch[1]}.T`
    const name = decodeEntities(linkMatch[2])
    if (!name || NON_STOCK_PATTERN.test(name)) continue

    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
      stripTags(cell[1]),
    )
    if (cells.length < 4) continue

    const supplements = [...rowHtml.matchAll(/<li class="RankingTable__supplement[^"]*">([\s\S]*?)<\/li>/g)]
      .map((item) => stripTags(item[1]))

    // td[1] は「取引値 日付」。先頭の数値が終値
    const close = extractNumbers(cells[1])[0]
    // td[2] は「前日比(円) 前日比(%)」。2つ目の数値が騰落率
    const changeNumbers = extractNumbers(cells[2])
    const changePercent = changeNumbers.length >= 2 ? changeNumbers[1] : undefined
    // td[3] は「出来高 株」
    const volume = extractNumbers(cells[3])[0]

    if (!Number.isFinite(close) || close <= 0) continue
    if (changePercent === undefined || !Number.isFinite(changePercent)) continue

    rows.push({
      code,
      name,
      segment: toSegment(supplements),
      close,
      return1d: changePercent / 100,
      volume: Number.isFinite(volume) ? volume : 0,
    })
  }

  return rows
}

/**
 * Yahoo!ファイナンス（日本）のランキング 1 ページを取得して行に変換する。
 * 取得失敗時は例外を投げず空配列を返す（1ページ落ちても候補は出せる）。
 * ただし subrequest 予算切れだけは呼び出し側へ伝える。
 */
async function fetchRankingPage(
  category: RankingCategory,
  page: number,
  budget: SubrequestBudget,
): Promise<RankingRow[]> {
  const url = `https://finance.yahoo.co.jp/stocks/ranking/${category}?market=all&term=daily&page=${page}`
  try {
    const html = await fetchCachedText(url, MARKET_DATA_CACHE_TTL_SECONDS, 'text/html', budget)
    return parseRankingRows(html)
  } catch (error) {
    if (isBudgetExhausted(error)) throw error
    return []
  }
}

export interface CandidateUniverseResult {
  rows: RankingRow[]
  /** 予算切れなどで取得しきれなかったページがある場合 true */
  partial: boolean
}

/**
 * 日本株全体から候補の母集団を発見する。
 * 「値下がり率ランキング（本日安くなった株）」を深く辿り、さらに
 * 「出来高ランキング（大型株・主力株を含める）」を加えて、幅広い銘柄を走査する。
 * 重複は先に見つかった側（値下がり）を優先する。
 */
export async function fetchCandidateUniverse(
  budget: SubrequestBudget,
  downPages: number,
  volumePages: number,
): Promise<CandidateUniverseResult> {
  const requests: Array<{ category: RankingCategory; page: number }> = []
  for (let page = 1; page <= downPages; page += 1) {
    requests.push({ category: 'down', page })
  }
  for (let page = 1; page <= volumePages; page += 1) {
    requests.push({ category: 'volume', page })
  }

  // 予算内に収まるページ数だけ並列取得する
  const affordable = budget.affordableFetches()
  const planned = requests.slice(0, affordable)
  let partial = planned.length < requests.length

  const settled = await Promise.allSettled(
    planned.map(({ category, page }) => fetchRankingPage(category, page, budget)),
  )

  const seen = new Set<string>()
  const rows: RankingRow[] = []
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') {
      partial = true
      continue
    }
    for (const row of outcome.value) {
      if (seen.has(row.code)) continue
      seen.add(row.code)
      rows.push(row)
    }
  }

  return { rows, partial }
}
