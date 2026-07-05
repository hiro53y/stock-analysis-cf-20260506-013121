import { DEFAULT_JP_WATCHLIST } from '../../shared/constants'
import { computeCandidate, rankCandidates } from '../../shared/analysis/candidates'
import type { CandidatesResponse, WatchlistEntry } from '../../shared/types'
import type { Env } from './lib/env'
import { errorResponseFromUnknown, getClientIp, jsonResponse } from './lib/http'
import { getSparkBatch } from './lib/market-data'
import { enforceRateLimit } from './lib/rate-limit'

function resolveWatchlist(url: URL): WatchlistEntry[] {
  const raw = (url.searchParams.get('symbols') ?? '').trim()
  if (!raw) return DEFAULT_JP_WATCHLIST

  const byCode = new Map(DEFAULT_JP_WATCHLIST.map((entry) => [entry.code, entry]))
  const requested = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .map<WatchlistEntry>((code) => byCode.get(code) ?? { code, name: code, sector: '—' })

  return requested.length > 0 ? requested : DEFAULT_JP_WATCHLIST
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  try {
    await enforceRateLimit(env, '/api/candidates', getClientIp(request))
    const url = new URL(request.url)
    const watchlist = resolveWatchlist(url)

    const closesBySymbol = await getSparkBatch(watchlist.map((entry) => entry.code))

    const rawCandidates = watchlist
      .map((entry) => {
        const closes = closesBySymbol.get(entry.code)
        if (!closes) return null
        return computeCandidate({ entry, closes })
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)

    const { candidates, counts } = rankCandidates(rawCandidates)

    const payload: CandidatesResponse = {
      generatedAt: new Date().toISOString(),
      registeredCount: watchlist.length,
      counts,
      candidates,
    }

    return jsonResponse(payload)
  } catch (error) {
    return errorResponseFromUnknown(error, '候補の取得に失敗しました。', 502)
  }
}
