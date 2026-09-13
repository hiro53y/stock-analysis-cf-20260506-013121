import { useCallback, useEffect, useState } from 'react'
import type {
  AnalysisRequestPayload,
  AnalysisResult,
  JobStatus,
  MarketDataResponse,
} from '../../shared/types'
import { analysisRequestSchema, validateSymbolInput } from '../../shared/validation'
import {
  ApiError,
  buildInitialForm,
  fetchAnalysisStatus,
  fetchMarketPreview,
  loadLastResult,
  persistLastResult,
  startAnalysis,
} from '../lib/api'

/** 画面上の状態。まだ一度も実行していない `idle` をジョブ状態と区別する。 */
export type ViewStatus = 'idle' | JobStatus

const MAX_POLL_ATTEMPTS = 120
const POLL_INTERVAL_MS = 1500
const PREVIEW_DEBOUNCE_MS = 450

export interface UseAnalysisResult {
  form: AnalysisRequestPayload
  setForm: (next: AnalysisRequestPayload) => void
  status: ViewStatus
  progress: number
  progressMessage: string
  error: string | null
  result: AnalysisResult | null
  preview: MarketDataResponse | null
  previewLoading: boolean
  isSubmitting: boolean
  submit: (override?: AnalysisRequestPayload) => Promise<void>
}

/**
 * 個別株分析の状態機械（入力・プレビュー取得・ジョブ起動・状態ポーリング・永続化）。
 *
 * App.tsx に直接置くと、候補抽出タブや使用方法タブと同じコンポーネントに
 * 11 個の useState が同居して見通しが悪くなるため切り出している。
 */
export function useAnalysis(): UseAnalysisResult {
  const [form, setForm] = useState<AnalysisRequestPayload>(buildInitialForm())
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  // 前回の結果を端末から復元した場合は「完了」として始める。
  // idle のまま始めると、結果が表示されているのに「未実行 / まだ実行していません」と出てしまう。
  const [restored] = useState<AnalysisResult | null>(() => loadLastResult())
  const [status, setStatus] = useState<ViewStatus>(restored ? 'completed' : 'idle')
  const [progress, setProgress] = useState(restored ? 100 : 0)
  const [progressMessage, setProgressMessage] = useState(
    restored ? '前回の分析結果を表示しています' : 'まだ実行していません',
  )
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(restored)
  const [preview, setPreview] = useState<MarketDataResponse | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // 入力中の銘柄プレビュー（デバウンス付き。古い応答は abort で破棄する）
  useEffect(() => {
    if (!form.symbol || !validateSymbolInput(form.symbol)) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setPreview(null)
      setPreviewLoading(false)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }

    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        setPreviewLoading(true)
        const nextPreview = await fetchMarketPreview(form.symbol, form.market, controller.signal)
        if (!active) return
        setPreview(nextPreview)
      } catch (previewError) {
        if (previewError instanceof DOMException && previewError.name === 'AbortError') return
        if (!active) return
        setPreview(null)
      } finally {
        if (active) setPreviewLoading(false)
      }
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [form.market, form.symbol])

  // 分析ジョブの状態ポーリング
  useEffect(() => {
    if (!analysisId) return

    let cancelled = false
    let timerId = 0
    let attempts = 0
    let retryCount = 0

    const schedulePoll = (delayMs: number) => {
      timerId = window.setTimeout(() => {
        void poll()
      }, delayMs)
    }

    const poll = async () => {
      attempts += 1
      if (attempts > MAX_POLL_ATTEMPTS) {
        setStatus('error')
        setProgress(100)
        setProgressMessage('分析の待機時間が長すぎるため停止しました。')
        setError('分析がタイムアウトしました。しばらく待ってから再度お試しください。')
        return
      }

      try {
        const snapshot = await fetchAnalysisStatus(analysisId)
        if (cancelled) return

        retryCount = 0
        setError(null)
        setStatus(snapshot.status)
        setProgress(snapshot.progress)
        setProgressMessage(snapshot.progressMessage)

        if (snapshot.result) {
          setResult(snapshot.result)
          persistLastResult(snapshot.result)
        }

        if (snapshot.status === 'completed' || snapshot.status === 'error') {
          if (snapshot.error) setError(snapshot.error)
          return
        }

        schedulePoll(POLL_INTERVAL_MS)
      } catch (pollError) {
        if (cancelled) return

        // 4xx（429 を除く）は再試行しても状況が変わらないため打ち切る
        if (
          pollError instanceof ApiError &&
          pollError.status >= 400 &&
          pollError.status < 500 &&
          pollError.status !== 429
        ) {
          setStatus('error')
          setProgress(100)
          setProgressMessage('分析状態の取得を終了しました。')
          setError(pollError.message)
          return
        }

        retryCount += 1
        setError(pollError instanceof Error ? pollError.message : '状態取得に失敗しました。')
        setProgressMessage('状態取得に失敗したため再試行しています...')
        schedulePoll(Math.min(5000, 1000 + retryCount * 1000))
      }
    }

    void poll()

    return () => {
      cancelled = true
      window.clearTimeout(timerId)
    }
  }, [analysisId])

  const submit = useCallback(
    async (override?: AnalysisRequestPayload) => {
      const payload = override ?? form
      const validation = analysisRequestSchema.safeParse(payload)
      if (!validation.success) {
        setStatus('error')
        setError(validation.error.issues[0]?.message ?? '入力内容を確認してください。')
        return
      }

      try {
        setError(null)
        setAnalysisId(null)
        setResult(null)
        setProgress(0)
        setProgressMessage('分析ジョブを起動しています...')
        setStatus('queued')

        const created = await startAnalysis(payload)
        const nextAnalysisId = created.analysisId?.trim()
        if (!nextAnalysisId) {
          console.error('analysisId missing after startAnalysis', created)
          throw new Error('分析開始レスポンスに analysisId がありません。')
        }

        // 同期実行で結果が返った場合はポーリングせずそのまま反映する
        if (created.result) {
          setStatus(created.status)
          setProgress(100)
          setProgressMessage(
            created.cached ? 'キャッシュ済み結果を表示しています。' : '分析が完了しました。',
          )
          setResult(created.result)
          persistLastResult(created.result)
          return
        }

        setAnalysisId(nextAnalysisId)
        setStatus(created.status)
        setProgress(created.cached || created.status === 'error' ? 100 : 10)
        setProgressMessage(
          created.cached
            ? 'キャッシュ済み結果を読み込みました。'
            : created.status === 'error'
              ? 'バックグラウンド処理の起動に失敗しました。'
              : '分析ジョブを作成しました。',
        )
      } catch (submitError) {
        setStatus('error')
        setError(submitError instanceof Error ? submitError.message : '分析を開始できませんでした。')
      }
    },
    [form],
  )

  return {
    form,
    setForm,
    status,
    progress,
    progressMessage,
    error,
    result,
    preview,
    previewLoading,
    isSubmitting: status === 'queued' || status === 'running',
    submit,
  }
}
