import { analyzeMarketData } from '../../../shared/analysis/engine'
import type { AnalysisRequestPayload, AnalysisResult } from '../../../shared/types'
import type { Env } from './env'
import { getMarketData, normalizeSymbol } from './market-data'
import { clearInFlightAnalysis, getCachedAnalysis, setCachedAnalysis, updateJob } from './store'

export interface WorkerPayload {
  analysisId: string
  cacheKey: string
  request: AnalysisRequestPayload
}

export async function runAnalysisWorker(env: Env, payload: WorkerPayload): Promise<AnalysisResult> {
  try {
    const normalized = normalizeSymbol(payload.request.symbol, payload.request.market)
    await updateJob(env, payload.analysisId, {
      status: 'running',
      progress: 10,
      progressMessage: '市場データを取得しています...',
      normalizedSymbol: normalized.normalizedSymbol,
      market: normalized.market,
    })

    const cached = await getCachedAnalysis(env, payload.cacheKey)
    if (cached) {
      await updateJob(env, payload.analysisId, {
        status: 'completed',
        progress: 100,
        progressMessage: 'キャッシュ済み結果を返しました。',
        cached: true,
        result: cached,
      })
      return cached
    }

    const marketData = await getMarketData(payload.request.symbol, payload.request.market)
    await updateJob(env, payload.analysisId, {
      status: 'running',
      progress: 45,
      progressMessage: '分析モデルを計算しています...',
      normalizedSymbol: marketData.normalizedSymbol,
      market: marketData.market,
    })

    const result = analyzeMarketData({
      analysisId: payload.analysisId,
      request: payload.request,
      marketData,
    })

    await updateJob(env, payload.analysisId, {
      status: 'running',
      progress: 85,
      progressMessage: '結果を保存しています...',
    })
    await setCachedAnalysis(env, payload.cacheKey, result)
    await updateJob(env, payload.analysisId, {
      status: 'completed',
      progress: 100,
      progressMessage: '分析が完了しました。',
      result,
    })
    return result
  } finally {
    await clearInFlightAnalysis(env, payload.cacheKey).catch(() => {})
  }
}
