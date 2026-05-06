import type { Env } from '../lib/env'
import { errorResponse, errorResponseFromUnknown, getClientIp, jsonResponse } from '../lib/http'
import { getMarketData } from '../lib/market-data'
import { enforceRateLimit } from '../lib/rate-limit'
import type { MarketCode } from '../../../shared/types'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context

  // CF Pages は path param を自動デコード済みのため decodeURIComponent は適用しない
  // query param は URLSearchParams が自動デコード済みのため同様
  const routeSymbol = typeof params.symbol === 'string' ? params.symbol.trim() : ''
  const url = new URL(request.url)
  const querySymbol = (url.searchParams.get('symbol') ?? '').trim()

  const symbol = routeSymbol || querySymbol
  if (!symbol) {
    return errorResponse('symbol が必要です。', 400)
  }

  const marketParam = url.searchParams.get('market') ?? 'auto'
  const market: MarketCode =
    marketParam === 'JP' || marketParam === 'US' ? marketParam : 'auto'

  try {
    await enforceRateLimit(env, '/api/market-data', getClientIp(request))
    const marketData = await getMarketData(symbol, market)
    return jsonResponse(marketData)
  } catch (error) {
    return errorResponseFromUnknown(error, '市場データの取得に失敗しました。', 400)
  }
}
