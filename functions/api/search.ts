import type { Env } from './lib/env'
import { errorResponse, errorResponseFromUnknown, getClientIp, jsonResponse } from './lib/http'
import { searchSymbols } from './lib/market-data'
import { enforceRateLimit } from './lib/rate-limit'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  const url = new URL(request.url)
  const query = (url.searchParams.get('q') ?? '').trim()
  if (!query) {
    return errorResponse('検索キーワード q が必要です。', 400)
  }

  try {
    await enforceRateLimit(env, '/api/search', getClientIp(request))
    const results = await searchSymbols(query)
    return jsonResponse({ query, results })
  } catch (error) {
    return errorResponseFromUnknown(error, '銘柄検索に失敗しました。', 502)
  }
}
