import { CACHE_VERSION } from '../../shared/constants'
import { createUuid, hashKey } from '../../shared/utils'
import { parseAnalysisRequest } from '../../shared/validation'
import type { AnalysisCreateResponse, AnalysisJobRecord } from '../../shared/types'
import type { Env } from './lib/env'
import { errorResponseFromUnknown, getClientIp, jsonResponse } from './lib/http'
import { normalizeSymbol } from './lib/market-data'
import { enforceRateLimit } from './lib/rate-limit'
import {
  clearInFlightAnalysis,
  getCachedAnalysis,
  getInFlightAnalysis,
  getJob,
  setInFlightAnalysis,
  setJob,
  updateJob,
} from './lib/store'
import { runAnalysisWorker } from './lib/worker'

// Cloudflare Pages Functions は Background Functions を持たないため
// 常に同期実行（Netlify の canUseBackgroundProcessing()=false 相当）
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  try {
    await enforceRateLimit(env, '/api/analyses', getClientIp(request))
    const input = parseAnalysisRequest(await request.json())
    const normalized = normalizeSymbol(input.symbol, input.market)
    const cacheKey = hashKey(
      JSON.stringify({
        ...input,
        normalizedSymbol: normalized.normalizedSymbol,
        market: normalized.market,
        version: CACHE_VERSION,
      }),
    )
    const cached = await getCachedAnalysis(env, cacheKey)
    const now = new Date().toISOString()

    if (!cached) {
      const activeAnalysisId = await getInFlightAnalysis(env, cacheKey)
      if (activeAnalysisId) {
        const activeJob = await getJob(env, activeAnalysisId)
        if (activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')) {
          const payload: AnalysisCreateResponse = {
            analysisId: activeJob.analysisId,
            status: activeJob.status,
            cached: false,
          }
          return jsonResponse(payload, 202)
        }
        await clearInFlightAnalysis(env, cacheKey).catch(() => {})
      }
    }

    const analysisId = createUuid()

    const job: AnalysisJobRecord = {
      analysisId,
      cacheKey,
      status: cached ? 'completed' : 'queued',
      progress: cached ? 100 : 0,
      progressMessage: cached ? 'キャッシュ済み結果を返しました。' : '分析ジョブを作成しました。',
      createdAt: now,
      updatedAt: now,
      cached: Boolean(cached),
      request: input,
      symbol: input.symbol,
      normalizedSymbol: normalized.normalizedSymbol,
      market: normalized.market,
      result: cached ?? undefined,
    }

    await setJob(env, job)

    let finalStatus = job.status
    let immediateResult = cached ?? undefined

    if (!cached) {
      // CF Pages には Background Functions がないため同期実行
      try {
        await setInFlightAnalysis(env, cacheKey, analysisId)
        immediateResult = await runAnalysisWorker(env, {
          analysisId,
          cacheKey,
          request: input,
        })
        finalStatus = 'completed'
      } catch (workerError) {
        // clearInFlightAnalysis は runAnalysisWorker の finally で呼ばれるため
        // ここでは updateJob のみ実行（二重 delete を避ける）
        await updateJob(env, analysisId, {
          status: 'error',
          progress: 100,
          progressMessage: '分析中にエラーが発生しました。',
          error:
            workerError instanceof Error
              ? workerError.message
              : '分析処理に失敗しました。',
        })
        finalStatus = 'error'
      }
    }

    const payload: AnalysisCreateResponse = {
      analysisId,
      status: finalStatus,
      cached: job.cached,
      result: finalStatus === 'completed' ? immediateResult : undefined,
    }

    return jsonResponse(payload, 202)
  } catch (error) {
    return errorResponseFromUnknown(error, '分析ジョブの作成に失敗しました。', 400)
  }
}
