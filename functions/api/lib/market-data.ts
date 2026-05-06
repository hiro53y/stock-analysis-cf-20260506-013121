import { HISTORY_RANGE, MARKET_DATA_CACHE_TTL_SECONDS } from '../../../shared/constants'
import type { MarketCode, MarketDataResponse, OHLCVRow, ResolvedMarket } from '../../../shared/types'
import { HttpError } from './http'

export function normalizeSymbol(
  symbol: string,
  market: MarketCode,
): { normalizedSymbol: string; market: ResolvedMarket } {
  const trimmed = symbol.trim().toUpperCase()
  const baseSymbol = trimmed.replace(/\.T$/, '')
  const looksLikeJpTicker =
    /^\d{4}$/.test(baseSymbol) && (trimmed === baseSymbol || trimmed.endsWith('.T'))

  if (market === 'JP' || (market === 'auto' && looksLikeJpTicker)) {
    return { normalizedSymbol: `${baseSymbol}.T`, market: 'JP' }
  }
  return { normalizedSymbol: baseSymbol, market: 'US' }
}

async function fetchCachedJson(url: string, ttlSeconds: number): Promise<unknown> {
  const request = new Request(url)
  const cacheApi =
    typeof caches !== 'undefined' ? await caches.open('stock-analysis-cache') : null
  const cached = cacheApi ? await cacheApi.match(request) : null

  if (cached) {
    const expiresAt = Number(cached.headers.get('x-cache-expires-at'))
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
      return cached.json()
    }
  }

  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Cloudflare Stock Analysis App)',
      accept: 'application/json',
    },
  })

  const text = await response.text()
  if (response.status === 429 || text.includes('Too Many Requests')) {
    throw new HttpError(
      'Yahoo Finance のアクセス制限（レートリミット）により取得できませんでした。数分後に再度お試しください。',
      429,
    )
  }
  if (!response.ok) {
    throw new HttpError(`データ取得に失敗しました。HTTP ${response.status}`, 502)
  }

  if (cacheApi) {
    const headers = new Headers({
      'content-type': 'application/json',
      'x-cache-expires-at': String(Date.now() + ttlSeconds * 1000),
    })
    await cacheApi.put(request, new Response(text, { headers }))
  }

  return JSON.parse(text)
}

function sanitizeRows(rawRows: Array<OHLCVRow | null>): OHLCVRow[] {
  return rawRows.filter((row): row is OHLCVRow => row !== null)
}

async function fetchCompanyName(normalizedSymbol: string): Promise<string> {
  try {
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(normalizedSymbol)}`
    const payload = (await fetchCachedJson(quoteUrl, MARKET_DATA_CACHE_TTL_SECONDS)) as {
      quoteResponse?: {
        result?: Array<{ shortName?: string; longName?: string }>
      }
    }
    const entry = payload.quoteResponse?.result?.[0]
    return entry?.shortName ?? entry?.longName ?? normalizedSymbol
  } catch {
    return normalizedSymbol
  }
}

export async function getMarketData(
  symbol: string,
  market: MarketCode,
): Promise<MarketDataResponse> {
  const normalized = normalizeSymbol(symbol, market)
  const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    normalized.normalizedSymbol,
  )}?range=${HISTORY_RANGE}&interval=1d&includePrePost=false&events=div%2Csplits`
  const payload = (await fetchCachedJson(chartUrl, MARKET_DATA_CACHE_TTL_SECONDS)) as {
    chart?: {
      result?: Array<{
        timestamp?: number[]
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>
            high?: Array<number | null>
            low?: Array<number | null>
            close?: Array<number | null>
            volume?: Array<number | null>
          }>
        }
      }>
      error?: { description?: string }
    }
  }

  const result = payload.chart?.result?.[0]
  if (!result?.timestamp || !result.indicators?.quote?.[0]) {
    throw new HttpError(
      payload.chart?.error?.description ?? '対象銘柄の価格データを取得できませんでした。',
      404,
    )
  }

  const quote = result.indicators.quote[0]
  const rows = sanitizeRows(
    result.timestamp.map((timestamp, index) => {
      const open = quote.open?.[index]
      const high = quote.high?.[index]
      const low = quote.low?.[index]
      const close = quote.close?.[index]
      const volume = quote.volume?.[index]

      if (
        ![open, high, low, close, volume].every(
          (v) => typeof v === 'number' && Number.isFinite(v),
        )
      ) {
        return null
      }

      return {
        date: new Date(timestamp * 1000).toISOString(),
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        volume: volume as number,
      }
    }),
  )

  if (rows.length < 120) {
    throw new HttpError('分析に必要な価格データが十分にありません。', 422)
  }

  return {
    symbol,
    normalizedSymbol: normalized.normalizedSymbol,
    companyName: await fetchCompanyName(normalized.normalizedSymbol),
    market: normalized.market,
    latestDate: rows[rows.length - 1].date,
    rows,
  }
}
