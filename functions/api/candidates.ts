import { DEFAULT_JP_WATCHLIST } from '../../shared/constants'
import { computeCandidate, rankCandidates } from '../../shared/analysis/candidates'
import type { CandidatesResponse, WatchlistEntry } from '../../shared/types'
import { canonicalCode } from '../../shared/utils'
import type { Env } from './lib/env'
import { errorResponseFromUnknown, getClientIp, jsonResponse } from './lib/http'
import { fetchCandidateUniverse } from './lib/jp-ranking'
import { getSparkBatch } from './lib/market-data'
import { enforceRateLimit } from './lib/rate-limit'

/** `symbols` クエリ（登録銘柄コード）を正準化した WatchlistEntry[] に解決する。0件可。 */
function resolveRegistered(url: URL): WatchlistEntry[] {
  const raw = (url.searchParams.get('symbols') ?? '').trim()
  if (!raw) return []

  const byCode = new Map(DEFAULT_JP_WATCHLIST.map((entry) => [entry.code, entry]))
  const seen = new Set<string>()
  const registered: WatchlistEntry[] = []
  for (const value of raw.split(',')) {
    const code = canonicalCode(value)
    if (!code || seen.has(code)) continue
    seen.add(code)
    registered.push(byCode.get(code) ?? { code, name: code, sector: '—' })
  }
  return registered
}

/**
 * 本日の値下がりランキング（日本株全体）と登録銘柄をユニオンして母集団を作る。
 * 同一コードは登録銘柄の name/sector を優先する。
 */
function buildUniverse(decliners: WatchlistEntry[], registered: WatchlistEntry[]): WatchlistEntry[] {
  const byCode = new Map<string, WatchlistEntry>()
  for (const entry of decliners) byCode.set(entry.code, entry)
  for (const entry of registered) byCode.set(entry.code, entry) // 登録側で上書き
  return Array.from(byCode.values())
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  try {
    await enforceRateLimit(env, '/api/candidates', getClientIp(request))
    const url = new URL(request.url)
    const registered = resolveRegistered(url)

    // 発見源: 日本株全体の値下がり＋出来高上位（失敗時は空でフォールバック）。表示名はランキング社名。
    const discovered = (await fetchCandidateUniverse()).map<WatchlistEntry>((hit) => ({
      code: canonicalCode(hit.code),
      name: hit.name,
      sector: '—',
    }))

    const universe = buildUniverse(discovered, registered)
    const registeredCodes = new Set(registered.map((entry) => entry.code))

    const closesBySymbol = await getSparkBatch(universe.map((entry) => entry.code))

    const rawCandidates = universe
      .map((entry) => {
        const closes = closesBySymbol.get(entry.code)
        if (!closes) return null
        return computeCandidate({ entry, closes })
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      // 見送り（skip）は提案しない。ただし登録銘柄は常に残す。
      .filter((item) => item.category !== 'skip' || registeredCodes.has(item.code))

    const { candidates, counts } = rankCandidates(rawCandidates)

    const payload: CandidatesResponse = {
      generatedAt: new Date().toISOString(),
      registeredCount: registered.length,
      counts,
      candidates,
    }

    return jsonResponse(payload)
  } catch (error) {
    return errorResponseFromUnknown(error, '候補の取得に失敗しました。', 502)
  }
}
