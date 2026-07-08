import {
  HISTORY_RANGE,
  MARKET_DATA_CACHE_TTL_SECONDS,
  SPARK_BATCH_CHUNK,
} from '../../../shared/constants'
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

/**
 * 任意の URL を取得して生テキストで返す。Cache API を使って TTL キャッシュし、
 * 429/HTTP エラーは HttpError に正規化する。JSON でも HTML でも使える汎用版。
 */
export async function fetchCachedText(
  url: string,
  ttlSeconds: number,
  accept = 'application/json',
): Promise<string> {
  const request = new Request(url)
  const cacheApi =
    typeof caches !== 'undefined' ? await caches.open('stock-analysis-cache') : null
  const cached = cacheApi ? await cacheApi.match(request) : null

  if (cached) {
    const expiresAt = Number(cached.headers.get('x-cache-expires-at'))
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
      return cached.text()
    }
  }

  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Cloudflare Stock Analysis App)',
      accept,
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
      'x-cache-expires-at': String(Date.now() + ttlSeconds * 1000),
    })
    await cacheApi.put(request, new Response(text, { headers }))
  }

  return text
}

async function fetchCachedJson(url: string, ttlSeconds: number): Promise<unknown> {
  return JSON.parse(await fetchCachedText(url, ttlSeconds))
}

function sanitizeRows(rawRows: Array<OHLCVRow | null>): OHLCVRow[] {
  return rawRows.filter((row): row is OHLCVRow => row !== null)
}

function toFiniteCloses(closesRaw: unknown): number[] {
  if (!Array.isArray(closesRaw)) return []
  return closesRaw.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
}

/**
 * Yahoo Finance の spark エンドポイントで複数銘柄の終値を一括取得する。
 * 1 リクエストでウォッチリスト全体をまかなえるため、候補抽出のレート制限に優しい。
 * 返り値は 正規化シンボル → 古い→新しい順の終値配列。
 *
 * spark のレスポンスはシンボルをキーにしたフラットなマップ
 * （例: `{ "7203.T": { close: [...], symbol: "7203.T" } }`）で返る。
 * 念のため、旧来の `spark.result[].response[]` 形式もフォールバックで解釈する。
 */
async function getSparkChunk(
  symbols: string[],
  ttlSeconds: number,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>()
  if (symbols.length === 0) return result

  const sparkUrl = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(
    symbols.join(','),
  )}&range=3mo&interval=1d`

  const payload = (await fetchCachedJson(sparkUrl, ttlSeconds)) as Record<string, unknown> & {
    spark?: {
      result?: Array<{
        symbol?: string
        response?: Array<{ indicators?: { quote?: Array<{ close?: unknown }> } }>
      }>
    }
  }

  // 主フォーマット: シンボルをキーにしたフラットマップ
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'spark' || !value || typeof value !== 'object') continue
    const entry = value as { close?: unknown; symbol?: string }
    const closes = toFiniteCloses(entry.close)
    if (closes.length > 0) {
      result.set(entry.symbol ?? key, closes)
    }
  }

  // フォールバック: 旧 spark.result[].response[] 形式
  if (result.size === 0) {
    for (const entry of payload.spark?.result ?? []) {
      const closes = toFiniteCloses(entry.response?.[0]?.indicators?.quote?.[0]?.close)
      if (entry.symbol && closes.length > 0) {
        result.set(entry.symbol, closes)
      }
    }
  }

  return result
}

export async function getSparkBatch(
  symbols: string[],
  ttlSeconds: number = MARKET_DATA_CACHE_TTL_SECONDS,
): Promise<Map<string, number[]>> {
  const unique = Array.from(new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean)))
  if (unique.length === 0) return new Map<string, number[]>()

  // spark は一括で約20銘柄が上限のため、チャンクに分割して並列取得しマージする
  const chunks: string[][] = []
  for (let index = 0; index < unique.length; index += SPARK_BATCH_CHUNK) {
    chunks.push(unique.slice(index, index + SPARK_BATCH_CHUNK))
  }

  // 一部のチャンクが失敗（レート制限など）しても、成功分は活かして候補を出す。
  // 全チャンクが失敗した場合のみ、最初のエラーを投げて呼び出し側に伝える。
  const settled = await Promise.allSettled(
    chunks.map((chunk) => getSparkChunk(chunk, ttlSeconds)),
  )

  const merged = new Map<string, number[]>()
  let fulfilled = 0
  let firstError: unknown = null
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      fulfilled += 1
      for (const [symbol, closes] of outcome.value) {
        merged.set(symbol, closes)
      }
    } else if (firstError === null) {
      firstError = outcome.reason
    }
  }

  if (fulfilled === 0 && firstError !== null) {
    throw firstError
  }

  return merged
}

export interface SymbolSearchHit {
  symbol: string
  name: string
  exchange: string
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * Yahoo!ファイナンス（日本）の検索ページから会社名で銘柄を引く。
 * v6 autocomplete が漢字社名（例: 任天堂）を返さないケースのフォールバック。
 */
async function searchSymbolsFromJapan(
  query: string,
  ttlSeconds: number,
): Promise<SymbolSearchHit[]> {
  const url = `https://finance.yahoo.co.jp/search/?query=${encodeURIComponent(query)}`
  let html: string
  try {
    html = await fetchCachedText(url, ttlSeconds, 'text/html')
  } catch {
    return []
  }

  const hits: SymbolSearchHit[] = []
  const seen = new Set<string>()
  const item =
    /\/quote\/(\d{4})\.T"[\s\S]{0,400}?<h2 class="SearchItem__name[^"]*">([\s\S]*?)<\/h2>/g
  let match: RegExpExecArray | null
  while ((match = item.exec(html)) !== null && hits.length < 8) {
    const symbol = `${match[1]}.T`
    if (seen.has(symbol)) continue
    seen.add(symbol)
    const name = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '')).trim()
    hits.push({ symbol, name: name || symbol, exchange: '東証' })
  }
  return hits
}

/**
 * Yahoo Finance の autocomplete エンドポイントで会社名から銘柄を検索する。
 * v6 autocomplete は日本語クエリ（かな・漢字）に対応し、日本語の社名も返す。
 * 株式（type === 'S'）のみを対象にし、日本株（.T）を優先的に前へ並べる。
 */
export async function searchSymbols(
  query: string,
  ttlSeconds: number = MARKET_DATA_CACHE_TTL_SECONDS,
): Promise<SymbolSearchHit[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const searchUrl = `https://query2.finance.yahoo.com/v6/finance/autocomplete?query=${encodeURIComponent(
    trimmed,
  )}&lang=ja&region=JP`

  const payload = (await fetchCachedJson(searchUrl, ttlSeconds)) as {
    ResultSet?: {
      Result?: Array<{
        symbol?: string
        name?: string
        type?: string
        exch?: string
        exchDisp?: string
      }>
    }
  }

  const hits: SymbolSearchHit[] = []
  for (const item of payload.ResultSet?.Result ?? []) {
    if (item.type && item.type.toUpperCase() !== 'S') continue
    const symbol = item.symbol?.trim()
    if (!symbol) continue
    hits.push({
      symbol,
      name: item.name ?? symbol,
      exchange: item.exchDisp ?? item.exch ?? '',
    })
  }

  // autocomplete が0件（漢字社名などで発生）の場合は Yahoo Japan 検索でフォールバック
  if (hits.length === 0) {
    return searchSymbolsFromJapan(trimmed, ttlSeconds)
  }

  // 日本株（.T）を優先
  hits.sort((a, b) => Number(b.symbol.endsWith('.T')) - Number(a.symbol.endsWith('.T')))
  return hits
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
