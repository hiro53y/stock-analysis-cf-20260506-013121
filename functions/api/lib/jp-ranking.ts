import {
  CANDIDATE_UNIVERSE_SIZE,
  MARKET_DATA_CACHE_TTL_SECONDS,
  RANKING_DOWN_PAGES,
  RANKING_VOLUME_PAGES,
} from '../../../shared/constants'
import { fetchCachedText } from './market-data'

export interface RankingHit {
  /** 正準シンボル（例: 7203.T） */
  code: string
  name: string
}

type RankingCategory = 'down' | 'volume'

// ETF/ETN/指数連動などの非・個別株を社名から除外する。
// 注意: 「ブル」「ベア」等の裸のカタカナは正規銘柄（ブルボン/ダブル・スコープ/ブルーイノベーション等）に
// 誤爆するため使わない。ETF は「上場投信/ETF/レバレッジ/インバース/日経/TOPIX」で十分に捕捉できる。
const NON_STOCK_PATTERN =
  /ETF|ETN|上場投信|投信|日経|ＴＯＰＩＸ|TOPIX|レバレッジ|インバース|ＲＥＩＴ|REIT|リート/i

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

/**
 * Yahoo!ファイナンス（日本）のランキング HTML から銘柄を発見する。
 * 数値は使わず、コードと社名だけを取り出す（変化率などは呼び出し側が spark + 分析で算出）。
 * 取得失敗時は例外を投げず空配列を返す。
 */
async function fetchRankingPage(category: RankingCategory, page: number): Promise<RankingHit[]> {
  const url = `https://finance.yahoo.co.jp/stocks/ranking/${category}?market=all&term=daily&page=${page}`
  let html: string
  try {
    html = await fetchCachedText(url, MARKET_DATA_CACHE_TTL_SECONDS, 'text/html')
  } catch {
    return []
  }

  const hits: RankingHit[] = []
  const anchor = /quote\/(\d{4}\.T)"[^>]*>([^<]+)<\/a>/g
  let match: RegExpExecArray | null
  while ((match = anchor.exec(html)) !== null) {
    const code = match[1]
    const name = decodeEntities(match[2])
    if (!name || NON_STOCK_PATTERN.test(name)) continue
    hits.push({ code, name })
  }
  return hits
}

/**
 * 日本株全体から候補の母集団を発見する。
 * 「値下がり率ランキング（本日安くなった株）」を深く辿り、さらに
 * 「出来高ランキング（大型株・主力株を含める）」を加えて、幅広い銘柄を走査する。
 * 重複は値下がり側の社名を優先。limit 件まで（既定 300）。
 */
export async function fetchCandidateUniverse(
  limit = CANDIDATE_UNIVERSE_SIZE,
): Promise<RankingHit[]> {
  const tasks: Promise<RankingHit[]>[] = []
  // 値下がり率（本日安くなった株）を優先的に深掘り
  for (let page = 1; page <= RANKING_DOWN_PAGES; page += 1) {
    tasks.push(fetchRankingPage('down', page))
  }
  // 出来高上位（流動性のある主力株・大型株を母集団に含める）
  for (let page = 1; page <= RANKING_VOLUME_PAGES; page += 1) {
    tasks.push(fetchRankingPage('volume', page))
  }

  const pages = await Promise.all(tasks)

  const seen = new Set<string>()
  const universe: RankingHit[] = []
  for (const hits of pages) {
    for (const hit of hits) {
      if (seen.has(hit.code)) continue
      seen.add(hit.code)
      universe.push(hit)
      if (universe.length >= limit) return universe
    }
  }
  return universe
}
