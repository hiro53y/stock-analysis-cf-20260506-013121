import { useState } from 'react'
import { DEFAULT_ANALYSIS_INPUT, DEFAULT_JP_WATCHLIST } from '../../shared/constants'
import type { WatchlistEntry } from '../../shared/types'
import { canonicalCode } from '../../shared/utils'
import type { UseAnalysisResult, ViewStatus } from '../hooks/useAnalysis'
import { AnalysisForm } from './AnalysisForm'
import { BacktestPanel } from './BacktestPanel'
import { ExplainabilityPanel } from './ExplainabilityPanel'
import { OverviewPanel } from './OverviewPanel'

type ResultTabKey = 'overview' | 'backtest' | 'explain'

const resultTabLabels: Record<ResultTabKey, string> = {
  overview: '概要',
  backtest: 'バックテスト',
  explain: '説明可能性',
}

const statusLabels: Record<ViewStatus, string> = {
  idle: '未実行',
  queued: '待機中',
  running: '実行中',
  completed: '完了',
  error: 'エラー',
}

interface ResearchTabProps {
  analysis: UseAnalysisResult
  registry: WatchlistEntry[]
  isOffline: boolean
  onRegister: (entry: WatchlistEntry) => void
  onUnregister: (code: string) => void
}

function lookupSector(normalizedSymbol: string): string | null {
  return DEFAULT_JP_WATCHLIST.find((entry) => entry.code === normalizedSymbol)?.sector ?? null
}

/**
 * 実行状況。ラベルは必ず日本語表に通す。
 * 以前は `status` の生値（`completed` など）をそのまま表示していたため、
 * 未実行の状態で「待機中」の見出しと `completed` バッジが同時に出ていた。
 */
function StatusBanner({
  status,
  progress,
  message,
}: {
  status: ViewStatus
  progress: number
  message: string
}) {
  return (
    <section className="panel status-panel">
      <div className="status-header">
        <div>
          <p className="eyebrow">実行状況</p>
          <h2 aria-live="polite">{message}</h2>
        </div>
        <span className={`status-chip status-${status}`}>{statusLabels[status]}</span>
      </div>
      {status === 'idle' ? null : (
        <>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="progress-meta">{progress.toFixed(0)}%</p>
        </>
      )}
    </section>
  )
}

export function ResearchTab({
  analysis,
  registry,
  isOffline,
  onRegister,
  onUnregister,
}: ResearchTabProps) {
  const [activeTab, setActiveTab] = useState<ResultTabKey>('overview')
  const { form, setForm, status, progress, progressMessage, error, result, preview, previewLoading } =
    analysis

  const sector = result ? lookupSector(result.normalizedSymbol) : null
  const isRegistered = result
    ? registry.some((item) => item.code === canonicalCode(result.normalizedSymbol))
    : false

  const handleRegisterResult = () => {
    if (!result) return
    onRegister({
      code: canonicalCode(result.normalizedSymbol),
      name: result.companyName,
      sector: sector ?? '—',
    })
  }

  return (
    <main className="layout-grid">
      <AnalysisForm
        value={form}
        disabled={analysis.isSubmitting}
        preview={preview}
        previewLoading={previewLoading}
        onChange={setForm}
        onSubmit={() => void analysis.submit()}
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
              <span>分析完了 {result.generatedAt.slice(0, 16).replace('T', ' ')}</span>
            </div>
            <div className="target-actions">
              {isRegistered ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onUnregister(result.normalizedSymbol)}
                >
                  登録済み（解除する）
                </button>
              ) : (
                <button type="button" className="primary-button" onClick={handleRegisterResult}>
                  登録銘柄に追加
                </button>
              )}
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
          <section className="panel error-panel" role="alert">
            <p className="eyebrow">エラー</p>
            <h2>分析エラー</h2>
            <p>{error}</p>
          </section>
        ) : null}

        <div className="tab-bar" role="tablist" aria-label="分析結果タブ">
          {(Object.keys(resultTabLabels) as ResultTabKey[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`result-tab-${tab}`}
              aria-selected={tab === activeTab}
              aria-controls={`result-panel-${tab}`}
              className={tab === activeTab ? 'tab-button active' : 'tab-button'}
              onClick={() => setActiveTab(tab)}
            >
              {resultTabLabels[tab]}
            </button>
          ))}
        </div>

        {result ? (
          <div
            role="tabpanel"
            id={`result-panel-${activeTab}`}
            aria-labelledby={`result-tab-${activeTab}`}
          >
            {activeTab === 'overview' ? <OverviewPanel result={result} /> : null}
            {activeTab === 'backtest' ? <BacktestPanel result={result} /> : null}
            {activeTab === 'explain' ? <ExplainabilityPanel result={result} /> : null}
          </div>
        ) : (
          <section className="panel empty-panel">
            <p className="eyebrow">まだ結果がありません</p>
            <h2>銘柄を指定して分析してください</h2>
            <p>
              上の入力欄に銘柄コードか会社名を入れて実行します。
              候補抽出タブの「詳しく分析」からも実行できます。
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setForm(DEFAULT_ANALYSIS_INPUT)}
            >
              入力をリセット
            </button>
          </section>
        )}
      </section>
    </main>
  )
}
