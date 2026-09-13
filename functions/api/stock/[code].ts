import {
  ANALYSIS_CACHE_TTL_SECONDS,
  MARKET_DATA_CACHE_TTL_SECONDS,
} from '../../../shared/constants'
import { computeTrackRecord } from '../../../shared/analysis/track-record'
import type { StockDetail } from '../../../shared/types'
import { canonicalCode } from '../../../shared/utils'
import type { Env } from '../lib/env'
import {
  HttpError,
  errorResponseFromUnknown,
  getClientIp,
  jsonResponse,
  upstreamStatusOf,
} from '../lib/http'
import { fetchCachedText, getSparkBatch } from '../lib/market-data'
import { enforceRateLimit } from '../lib/rate-limit'
import { getGenericStoreValue, setGenericStoreValue } from '../lib/store'
import { SubrequestBudget } from '../lib/subrequest-budget'
import { MINKABU_CONSENSUS_URL, hasNoAnalystCoverage, parseAnalystConsensus } from '../lib/minkabu'
import { parseStockDetail } from '../lib/yahoo-quote'

/**
 * 銘柄1件の判断材料を返す。
 *
 * 候補一覧では出せない情報をここでまとめて取る:
 * - Yahoo!ファイナンス銘柄ページの参考指標（PER/PBR/配当利回り/最低購入代金）と業績評価
 * - その銘柄が過去に安値圏へ下げたときの実績
 *
 * 一覧側で全銘柄ぶんやると、銘柄ページは1銘柄1リクエストなので subrequest 上限を超え、
 * 過去実績の集計も 60銘柄ぶんで CPU 時間の上限に触れる。
 * 利用者が実際に検討する銘柄だけ、開いたときに取得する。
 */

interface CachedDetail {
  storedAt: string
  detail: StockDetail
}

function isFresh(storedAt: string, ttlSeconds: number): boolean {
  const parsed = Date.parse(storedAt)
  if (!Number.isFinite(parsed)) return false
  return Date.now() - parsed <= ttlSeconds * 1000
}

/** `7203` `7203.T` のどちらでも受け取り、4桁の日本株コードだけを通す。 */
function resolveCode(raw: unknown): string {
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : ''
  const code = canonicalCode(String(value ?? ''))
  if (!/^\d{4}\.T$/.test(code)) {
    throw new HttpError('日本株の4桁コードを指定してください。', 400)
  }
  return code
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params, waitUntil } = context

  try {
    const code = resolveCode(params.code)

    const cached = await getGenericStoreValue<CachedDetail>(env, 'stock-detail', code).catch(
      () => null,
    )
    if (cached && isFresh(cached.storedAt, ANALYSIS_CACHE_TTL_SECONDS)) {
      return jsonResponse(cached.detail)
    }

    // 外部サイトへ取りにいくときだけ制限する（キャッシュから返すときは制限しない）
    await enforceRateLimit(env, '/api/stock', getClientIp(request))

    const budget = new SubrequestBudget()

    // 参考指標と業績評価（1リクエストで全部そろう）
    const html = await fetchCachedText(
      `https://finance.yahoo.co.jp/quote/${code}`,
      MARKET_DATA_CACHE_TTL_SECONDS,
      'text/html',
      budget,
    )
    const detail = parseStockDetail(html, code)

    // 証券アナリストのコンセンサス。取れなくても他の項目は返す価値があるので、
    // 失敗は partial フラグに落として握りつぶす。
    try {
      const consensusHtml = await fetchCachedText(
        MINKABU_CONSENSUS_URL(code.replace(/\.T$/, '')),
        MARKET_DATA_CACHE_TTL_SECONDS,
        'text/html',
        budget,
      )
      detail.analyst = parseAnalystConsensus(consensusHtml)
      if (detail.analyst) {
        detail.analystCoverage = 'covered'
      } else if (hasNoAnalystCoverage(consensusHtml)) {
        // カバーしているアナリストがいないだけ。取得は成功しているので partial にしない
        detail.analystCoverage = 'none'
      } else {
        detail.analystCoverage = 'unavailable'
        detail.partial = true
      }
    } catch (analystError) {
      // みんかぶ側が 404 を返す銘柄は、アナリスト予想のページ自体が存在しない
      // （＝誰もカバーしていない）。取得失敗と区別する。
      if (upstreamStatusOf(analystError) === 404) {
        detail.analystCoverage = 'none'
      } else {
        detail.analystCoverage = 'unavailable'
        detail.partial = true
      }
    }

    // 過去に安値圏へ下げたときの実績（履歴はまとめ取り用の spark を1銘柄で使う）
    try {
      const spark = await getSparkBatch([code], MARKET_DATA_CACHE_TTL_SECONDS, budget)
      const closes = spark.closesBySymbol.get(code)
      if (closes && closes.length > 0) {
        detail.trackRecord = computeTrackRecord(closes) ?? undefined
      }
    } catch {
      // 実績が出せなくても参考指標は返す価値がある
      detail.partial = true
    }

    waitUntil(
      setGenericStoreValue<CachedDetail>(
        env,
        'stock-detail',
        code,
        { storedAt: new Date().toISOString(), detail },
        ANALYSIS_CACHE_TTL_SECONDS * 2,
      ).catch(() => {}),
    )

    return jsonResponse(detail)
  } catch (error) {
    return errorResponseFromUnknown(error, '銘柄情報を取得できませんでした。', 502)
  }
}
