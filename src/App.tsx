import { useEffect, useState } from 'react'
import { DEFAULT_ANALYSIS_INPUT, DEFAULT_JP_WATCHLIST } from '../shared/constants'
import type { AnalysisRequestPayload, AnalysisResult, AnalysisStatusResponse, MarketDataResponse } from '../shared/types'
import { analysisRequestSchema, validateSymbolInput } from '../shared/validation'
import { AnalysisForm } from './components/AnalysisForm'
import { BacktestPanel } from './components/BacktestPanel'
import { CandidatesTab } from './components/CandidatesTab'
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
type MainTabKey = 'candidates' | 'research'
const MAX_POLL_ATTEMPTS = 120

const tabLabels: Record<TabKey, string> = {
  overview: '概要',
  backtest: 'バックテスト',
  explain: '説明可能性',
}

const mainTabLabels: Record<MainTabKey, string> = {
  candidates: '候補抽出',
  research: '個別株調査',
}

const statusLabels: Record<AnalysisStatusResponse['status'], string> = {
  queued: '待機中',
  running: '実行中',
  completed: '完了',
  error: 'エラー',
}

function lookupSector(normalizedSymbol: string): string | null {
  return DEFAULT_JP_WATCHLIST.find((entry) => entry.code === normalizedSymbol)?.sector ?? null
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
  const [mainTab, setMainTab] = useState<MainTabKey>('candidates')
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
      // 入力が無効なときはプレビューをクリア（外部データ同期のための副作用）
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

  const handleSubmit = async (override?: AnalysisRequestPayload) => {
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
      setActiveTab('overview')
      setProgress(0)
      setProgressMessage('分析ジョブを起動しています...')
      setStatus('queued')
      const created = await startAnalysis(payload)
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

  // 候補抽出タブの「分析」から個別株調査へ遷移し、銘柄コードを引き継いで自動実行する
  const handleAnalyzeCandidate = (code: string) => {
    const nextForm: AnalysisRequestPayload = {
      ...form,
      symbol: code.replace(/\.T$/i, ''),
      market: 'JP',
    }
    setForm(nextForm)
    setMainTab('research')
    void handleSubmit(nextForm)
  }

  const sector = result ? lookupSector(result.normalizedSymbol) : null

  return (
    <div className="app-shell">
      <header className="hero-shell">
        <div className="hero-copy">
          <h1>株式意思決定支援アプリ</h1>
          <p>
            登録した日本株の中から候補を整理し、気になる銘柄を個別に調査できます。
          </p>
        </div>
        <div className="hero-stat">
          <span>最終更新</span>
          <strong>{result ? result.generatedAt.slice(0, 16).replace('T', ' ') : '未実行'}</strong>
        </div>
      </header>

      <nav className="main-tab-bar" aria-label="メインタブ">
        {(Object.keys(mainTabLabels) as MainTabKey[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={tab === mainTab ? 'main-tab active' : 'main-tab'}
            onClick={() => setMainTab(tab)}
          >
            {mainTabLabels[tab]}
          </button>
        ))}
      </nav>

      <p className="tab-description">
        {mainTab === 'candidates'
          ? '登録銘柄の中から、短期売買で確認したい候補を優先表示します。'
          : '銘柄コードを入力して、株価・騰落率・分析結果を個別に確認できます。'}
      </p>

      {mainTab === 'candidates' ? (
        <CandidatesTab onAnalyze={handleAnalyzeCandidate} />
      ) : (
        <main className="layout-grid">
          <AnalysisForm
            value={form}
            disabled={isSubmitting}
            preview={preview}
            previewLoading={previewLoading}
            onChange={setForm}
            onSubmit={() => handleSubmit()}
          />

          <section className="content-column">
            {result ? (
              <section className="panel target-summary">
                <div className="target-head">
                  <div>
                    <p className="target-symbol">{result.normalizedSymbol}</p>
                    <h2 className="target-name">{result.companyName}</h2>
                  </div>
                  <span className={`status-chip status-${status}`}>{statusLabels[status]}</span>
                </div>
                <div className="target-meta">
                  <span>市場: {result.market}</span>
                  {sector ? <span>業種: {sector}</span> : null}
                  <span>
                    分析完了 {result.generatedAt.slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
              </section>
            ) : null}

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
                  デフォルト値は `7203 / auto / buy 0.6 / sell 0.4` です。上の入力パネルから実行してください。
                </p>
                <button type="button" className="secondary-button" onClick={() => setForm(DEFAULT_ANALYSIS_INPUT)}>
                  デフォルト値に戻す
                </button>
              </section>
            )}
          </section>
        </main>
      )}
    </div>
  )
}
