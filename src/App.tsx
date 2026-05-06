import { useEffect, useState } from 'react'
import { DEFAULT_ANALYSIS_INPUT } from '../shared/constants'
import type { AnalysisRequestPayload, AnalysisResult, AnalysisStatusResponse, MarketDataResponse } from '../shared/types'
import { analysisRequestSchema, validateSymbolInput } from '../shared/validation'
import { AnalysisForm } from './components/AnalysisForm'
import { BacktestPanel } from './components/BacktestPanel'
import { ExplainabilityPanel } from './components/ExplainabilityPanel'
import { OverviewPanel } from './components/OverviewPanel'
import {
  ApiError,
  buildInitialForm,
  fetchAnalysisStatus,
  fetchMarketPreview,
  loadLastResult,
  persistLastResult,
  startAnalysis,
} from './lib/api'

type TabKey = 'overview' | 'backtest' | 'explain'
const MAX_POLL_ATTEMPTS = 120

const tabLabels: Record<TabKey, string> = {
  overview: '概要',
  backtest: 'バックテスト',
  explain: '説明可能性',
}

function StatusBanner({
  status,
  progress,
  message,
}: {
  status: AnalysisStatusResponse['status']
  progress: number
  message: string
}) {
  return (
    <section className="panel status-panel">
      <div className="status-header">
        <div>
          <p className="eyebrow">実行状況</p>
          <h2>{message}</h2>
        </div>
        <span className={`status-chip status-${status}`}>{status}</span>
      </div>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${progress}%` }} />
      </div>
      <p className="progress-meta">{progress.toFixed(0)}%</p>
    </section>
  )
}

function readOfflineState(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  return navigator.onLine === false
}

export default function App() {
  const [form, setForm] = useState<AnalysisRequestPayload>(buildInitialForm())
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [status, setStatus] = useState<AnalysisStatusResponse['status']>('completed')
  const [progress, setProgress] = useState(100)
  const [progressMessage, setProgressMessage] = useState('待機中')
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(() => loadLastResult())
  const [preview, setPreview] = useState<MarketDataResponse | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [isOffline, setIsOffline] = useState(() => readOfflineState())

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!form.symbol || !validateSymbolInput(form.symbol)) {
      setPreview(null)
      setPreviewLoading(false)
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
        if (
          previewError instanceof DOMException &&
          previewError.name === 'AbortError'
        ) {
          return
        }
        if (!active) return
        setPreview(null)
      } finally {
        if (active) {
          setPreviewLoading(false)
        }
      }
    }, 450)

    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [form.market, form.symbol])

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

        schedulePoll(1500)
      } catch (pollError) {
        if (cancelled) return

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

  const isSubmitting = status === 'queued' || status === 'running'

  const handleSubmit = async () => {
    const validation = analysisRequestSchema.safeParse(form)
    if (!validation.success) {
      setStatus('error')
      setError(validation.error.issues[0]?.message ?? '入力内容を確認してください。')
      return
    }

    try {
      setError(null)
      setAnalysisId(null)
      setResult(null)
      setActiveTab('overview')
      setProgress(0)
      setProgressMessage('分析ジョブを起動しています...')
      setStatus('queued')
      const created = await startAnalysis(form)
      const nextAnalysisId = created.analysisId?.trim()
      if (!nextAnalysisId) {
        console.error('analysisId missing after startAnalysis', created)
        throw new Error('分析開始レスポンスに analysisId がありません。')
      }

      if (created.result) {
        setStatus(created.status)
        setProgress(100)
        setProgressMessage(
          created.cached ? 'キャッシュ済み結果を返しました。' : '分析が完了しました。',
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
  }

  return (
    <div className="app-shell">
      <header className="hero-shell">
        <div className="hero-copy">
          <p className="eyebrow">Netlify / PWA / Mobile First</p>
          <h1>株式意思決定支援アプリ</h1>
          <p>
            デスクトップ版の主要体験を、Android で操作しやすい Web アプリに再構成しています。
          </p>
        </div>
        <div className="hero-stat">
          <span>最終保存</span>
          <strong>{result ? result.generatedAt.slice(0, 16).replace('T', ' ') : '未実行'}</strong>
        </div>
      </header>

      <main className="layout-grid">
        <AnalysisForm
          value={form}
          disabled={isSubmitting}
          preview={preview}
          previewLoading={previewLoading}
          onChange={setForm}
          onSubmit={handleSubmit}
        />

        <section className="content-column">
          {isOffline && result ? (
            <section className="panel offline-panel">
              <p className="eyebrow">オフライン表示</p>
              <h2>直近成功結果を表示中</h2>
              <p>ネットワーク接続後に再分析すると、最新データへ更新されます。</p>
            </section>
          ) : null}

          <StatusBanner status={status} progress={progress} message={progressMessage} />

          {error ? (
            <section className="panel error-panel">
              <p className="eyebrow">エラー</p>
              <h2>分析エラー</h2>
              <p>{error}</p>
            </section>
          ) : null}

          <nav className="tab-bar" aria-label="分析結果タブ">
            {(Object.keys(tabLabels) as TabKey[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={tab === activeTab ? 'tab-button active' : 'tab-button'}
                onClick={() => setActiveTab(tab)}
              >
                {tabLabels[tab]}
              </button>
            ))}
          </nav>

          {result ? (
            <>
              {activeTab === 'overview' ? <OverviewPanel result={result} /> : null}
              {activeTab === 'backtest' ? <BacktestPanel result={result} /> : null}
              {activeTab === 'explain' ? <ExplainabilityPanel result={result} /> : null}
            </>
          ) : (
            <section className="panel empty-panel">
              <p className="eyebrow">待機中</p>
              <h2>まだ分析結果がありません</h2>
              <p>
                デフォルト値は `7203 / auto / buy 0.6 / sell 0.4` です。右上の入力パネルから実行してください。
              </p>
              <button type="button" className="secondary-button" onClick={() => setForm(DEFAULT_ANALYSIS_INPUT)}>
                デフォルト値に戻す
              </button>
            </section>
          )}
        </section>
      </main>
    </div>
  )
}
