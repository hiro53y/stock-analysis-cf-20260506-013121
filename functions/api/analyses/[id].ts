import type { AnalysisStatusResponse } from '../../../shared/types'
import type { Env } from '../lib/env'
import { errorResponse, errorResponseFromUnknown, jsonResponse } from '../lib/http'
import { getJob } from '../lib/store'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context

  // Cloudflare Pages のルートパラメータ（[id].ts → params.id）
  const routeId = typeof params.id === 'string' ? params.id.trim() : ''
  const url = new URL(request.url)
  const queryId = (url.searchParams.get('analysisId') ?? url.searchParams.get('id') ?? '').trim()

  const analysisId = routeId || queryId
  if (!analysisId) {
    return errorResponse('analysisId が必要です。', 400)
  }

  try {
    const job = await getJob(env, analysisId)
    if (!job) {
      return errorResponse('指定された分析ジョブが見つかりません。', 404)
    }

    const payload: AnalysisStatusResponse = {
      status: job.status,
      progress: job.progress,
      progressMessage: job.progressMessage,
      cached: job.cached,
      result: job.result,
      error: job.error,
    }

    return jsonResponse(payload)
  } catch (error) {
    return errorResponseFromUnknown(error, '分析状態の取得に失敗しました。', 500)
  }
}
