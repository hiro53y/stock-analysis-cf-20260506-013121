import {
  CANDIDATES_CACHE_TTL_SECONDS,
  CANDIDATES_STALE_TTL_SECONDS,
  CANDIDATE_PER_CATEGORY,
  MARKET_DATA_CACHE_TTL_SECONDS,
  MIN_TURNOVER_YEN,
  RANKING_DOWN_PAGES,
  RANKING_VOLUME_PAGES,
  SHORTLIST_BY_DECLINE,
  SHORTLIST_BY_TURNOVER,
  SHORTLIST_SIZE,
} from '../../shared/constants'
import { cheapnessScore, computeCandidate, rankCandidates } from '../../shared/analysis/candidates'
import type { CandidateEntry } from '../../shared/analysis/candidates'
import type {
  CandidateCategory,
  CandidateItem,
  CandidatesResponse,
  MarketSummary,
} from '../../shared/types'
import { canonicalCode } from '../../shared/utils'
import type { Env } from './lib/env'
import { errorResponseFromUnknown, getClientIp, jsonResponse } from './lib/http'
import { fetchCandidateUniverse, type RankingRow } from './lib/jp-ranking'
import { getSparkBatch } from './lib/market-data'
import { enforceRateLimit } from './lib/rate-limit'
import { getGenericStoreValue, setGenericStoreValue } from './lib/store'
import { SubrequestBudget } from './lib/subrequest-budget'

/** `symbols` クエリ（登録銘柄コード）を正準化して返す。0件可。 */
function resolveRegistered(url: URL): string[] {
  const raw = (url.searchParams.get('symbols') ?? '').trim()
  if (!raw) return []

  const seen = new Set<string>()
  for (const value of raw.split(',')) {
    const code = canonicalCode(value)
    if (code) seen.add(code)
  }
  return [...seen].sort()
}

type ScoredCandidate = Omit<CandidateItem, 'rank'>

/**
 * 各カテゴリを割安な順に最大 max 件へ絞る。
 * 登録銘柄はユーザーの明示的な選択なので、上限を超えても常に残す。
 */
function capPerCategory(
  items: ScoredCandidate[],
  max: number,
  registeredCodes: Set<string>,
): ScoredCandidate[] {
  const categories: CandidateCategory[] = ['buy', 'watch', 'trap', 'skip']
  const result: ScoredCandidate[] = []
  for (const category of categories) {
    const group = items
      .filter((item) => item.category === category)
      .sort((a, b) => cheapnessScore(b) - cheapnessScore(a))
    let count = 0
    for (const item of group) {
      const isRegistered = registeredCodes.has(item.code)
      if (isRegistered || count < max) {
        result.push(item)
        if (!isRegistered) count += 1
      }
    }
  }
  return result
}

/**
 * 一次選抜。ランキングから取れた当日値だけで、履歴を取りにいく銘柄を絞り込む。
 *
 * 売買代金上位（安値圏まで下げた主力株が拾える）と下落率上位（大きく崩れた銘柄が拾える）の
 * 両方から取ることで、片方に偏らないようにする。
 * この時点では割安さは分からない（履歴がまだない）ため、判定は二次分析に任せる。
 */
export function buildShortlist(
  rows: RankingRow[],
  registeredCodes: Set<string>,
  limit = SHORTLIST_SIZE,
): RankingRow[] {
  const tradable = rows.filter((row) => row.close * row.volume >= MIN_TURNOVER_YEN)
  const declining = tradable.filter((row) => row.return1d < 0)

  const byTurnover = [...declining].sort(
    (a, b) => b.close * b.volume - a.close * a.volume,
  )
  const byDecline = [...declining].sort((a, b) => a.return1d - b.return1d)

  const picked = new Map<string, RankingRow>()

  // 登録銘柄は流動性・騰落にかかわらず必ず分析する
  for (const row of rows) {
    if (registeredCodes.has(row.code)) picked.set(row.code, row)
  }
  for (const row of byTurnover.slice(0, SHORTLIST_BY_TURNOVER)) picked.set(row.code, row)
  for (const row of byDecline.slice(0, SHORTLIST_BY_DECLINE)) picked.set(row.code, row)

  return [...picked.values()].slice(0, limit)
}

function toEntry(row: RankingRow): CandidateEntry {
  return { code: row.code, name: row.name, segment: row.segment }
}

/**
 * 候補一覧を組み立てる。
 *
 * 二段構えにしているのは Cloudflare の subrequest 上限を超えないため。
 * 以前は発見した300銘柄すべてに spark を投げており（15リクエスト）、
 * ランキング取得と合わせて上限を超え、キャッシュが切れるたびに 502 になっていた。
 */
async function buildCandidates(
  registeredCodes: string[],
  budget: SubrequestBudget,
): Promise<CandidatesResponse> {
  const registeredSet = new Set(registeredCodes)

  // 一次選抜: ランキング HTML から当日の株価・騰落率・出来高まで取得する
  const universe = await fetchCandidateUniverse(budget, RANKING_DOWN_PAGES, RANKING_VOLUME_PAGES)
  const declining = universe.rows.filter((row) => row.return1d < 0)
  const shortlist = buildShortlist(universe.rows, registeredSet)

  // 二次分析: 絞り込んだ銘柄だけ株価履歴を取得する
  const spark = await getSparkBatch(
    shortlist.map((row) => row.code),
    MARKET_DATA_CACHE_TTL_SECONDS,
    budget,
  )

  const scored = shortlist
    .map((row) => {
      const closes = spark.closesBySymbol.get(row.code)
      if (!closes) return null
      return computeCandidate({
        entry: toEntry(row),
        today: { close: row.close, return1d: row.return1d, volume: row.volume },
        closes,
      })
    })
    .filter((item): item is ScoredCandidate => item !== null)
    // 見送り（skip）は提案しない。ただし登録銘柄は常に残す。
    .filter((item) => item.category !== 'skip' || registeredSet.has(item.code))

  const capped = capPerCategory(scored, CANDIDATE_PER_CATEGORY, registeredSet)
  const { candidates, counts } = rankCandidates(capped)

  const averageDecline =
    declining.length === 0
      ? 0
      : declining.reduce((sum, row) => sum + row.return1d, 0) / declining.length

  const summary: MarketSummary = {
    scanned: universe.rows.length,
    declining: declining.length,
    analyzed: spark.closesBySymbol.size,
    averageDecline,
    partial: universe.partial || spark.partial,
  }

  return {
    generatedAt: new Date().toISOString(),
    registeredCount: registeredCodes.length,
    counts,
    summary,
    candidates,
  }
}

interface CachedCandidates {
  storedAt: string
  payload: CandidatesResponse
}

function ageSeconds(storedAt: string): number {
  const parsed = Date.parse(storedAt)
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY
  return (Date.now() - parsed) / 1000
}

/**
 * 候補一覧は KV にキャッシュする（KV 操作は subrequest に数えられないため、
 * ヒット時は外部取得ゼロで返せる）。鮮度切れでも許容範囲内なら、
 * まず古い結果を返してから裏で作り直し、待ち時間と 502 リスクを両方避ける。
 */
async function readCache(env: Env, cacheKey: string): Promise<CachedCandidates | null> {
  try {
    return await getGenericStoreValue<CachedCandidates>(env, 'candidates', cacheKey)
  } catch {
    return null
  }
}

async function writeCache(env: Env, cacheKey: string, payload: CandidatesResponse): Promise<void> {
  try {
    await setGenericStoreValue<CachedCandidates>(
      env,
      'candidates',
      cacheKey,
      { storedAt: new Date().toISOString(), payload },
      CANDIDATES_STALE_TTL_SECONDS,
    )
  } catch {
    // キャッシュ書き込みに失敗しても、結果そのものは返せるので握りつぶす
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, waitUntil } = context

  try {
    await enforceRateLimit(env, '/api/candidates', getClientIp(request))

    const url = new URL(request.url)
    const registeredCodes = resolveRegistered(url)
    const cacheKey = registeredCodes.length > 0 ? registeredCodes.join(',') : 'default'

    const cached = await readCache(env, cacheKey)
    if (cached) {
      const age = ageSeconds(cached.storedAt)
      if (age <= CANDIDATES_CACHE_TTL_SECONDS) {
        return jsonResponse(cached.payload)
      }
      if (age <= CANDIDATES_STALE_TTL_SECONDS) {
        // 古い結果をすぐ返し、裏で作り直す
        waitUntil(
          buildCandidates(registeredCodes, new SubrequestBudget())
            .then((fresh) => writeCache(env, cacheKey, fresh))
            .catch(() => {}),
        )
        return jsonResponse(cached.payload)
      }
    }

    const payload = await buildCandidates(registeredCodes, new SubrequestBudget())
    waitUntil(writeCache(env, cacheKey, payload))
    return jsonResponse(payload)
  } catch (error) {
    return errorResponseFromUnknown(error, '候補の取得に失敗しました。', 502)
  }
}
