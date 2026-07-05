import { useCallback, useEffect, useState } from 'react'
import {
  CANDIDATE_CATEGORY_LABELS,
  CANDIDATE_DISCLAIMER,
  SAMPLE_MARKET_NEWS,
} from '../../shared/constants'
import type { CandidateCategory, CandidatesResponse } from '../../shared/types'
import { fetchCandidates, loadWatchlist, saveWatchlist } from '../lib/api'
import { CandidateCard } from './CandidateCard'
import { MarketNews } from './MarketNews'

interface CandidatesTabProps {
  onAnalyze: (code: string) => void
}

const FILTER_ORDER: CandidateCategory[] = ['dip', 'rebound', 'danger', 'skip']

function formatTimestamp(iso: string): string {
  if (!iso) return '—'
  return iso.slice(0, 16).replace('T', ' ')
}

export function CandidatesTab({ onAnalyze }: CandidatesTabProps) {
  const [data, setData] = useState<CandidatesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<CandidateCategory>('dip')
  const [watched, setWatched] = useState<string[]>(() => loadWatchlist())

  const loadCandidates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetchCandidates()
      setData(response)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '候補の取得に失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // マウント時に候補を取得（データ取得のための正当な副作用）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCandidates()
  }, [loadCandidates])

  const toggleWatch = useCallback((code: string) => {
    setWatched((current) => {
      const next = current.includes(code)
        ? current.filter((value) => value !== code)
        : [...current, code]
      saveWatchlist(next)
      return next
    })
  }, [])

  const counts = data?.counts ?? { dip: 0, rebound: 0, danger: 0, skip: 0 }
  const totalCandidates = counts.dip + counts.rebound + counts.danger
  const filtered = (data?.candidates ?? []).filter((item) => item.category === filter)

  return (
    <div className="candidates-tab">
      <section className="panel candidate-summary">
        <div className="summary-top">
          <h2 className="summary-title">
            <span className="flag" aria-hidden="true">
              ⚑
            </span>
            本日の候補
          </h2>
          <button
            type="button"
            className="refresh-button"
            onClick={() => void loadCandidates()}
            disabled={loading}
          >
            {loading ? '更新中…' : '↻ 更新'}
          </button>
        </div>

        <div className="summary-stats">
          <div className="stat-cell">
            <span className="stat-label">登録銘柄</span>
            <span className="stat-value">{data?.registeredCount ?? '—'}</span>
          </div>
          <div className="stat-cell">
            <span className="stat-label">候補</span>
            <span className="stat-value">{data ? totalCandidates : '—'}</span>
          </div>
          <div className="stat-cell">
            <span className="stat-label">押し目</span>
            <span className="stat-value val-accent">{data ? counts.dip : '—'}</span>
          </div>
          <div className="stat-cell">
            <span className="stat-label">反発</span>
            <span className="stat-value val-positive">{data ? counts.rebound : '—'}</span>
          </div>
          <div className="stat-cell">
            <span className="stat-label">危険</span>
            <span className="stat-value val-danger">{data ? counts.danger : '—'}</span>
          </div>
        </div>
        <p className="summary-updated">最終更新 {formatTimestamp(data?.generatedAt ?? '')}</p>
      </section>

      <nav className="chip-bar" aria-label="候補の絞り込み">
        {FILTER_ORDER.map((category) => (
          <button
            key={category}
            type="button"
            className={`chip chip-${category}${category === filter ? ' active' : ''}`}
            onClick={() => setFilter(category)}
          >
            {CANDIDATE_CATEGORY_LABELS[category]}
            <span className="chip-count">{counts[category]}</span>
          </button>
        ))}
      </nav>

      {error ? (
        <section className="panel error-panel">
          <p className="eyebrow">エラー</p>
          <h3>候補を取得できませんでした</h3>
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={() => void loadCandidates()}>
            再試行
          </button>
        </section>
      ) : null}

      {!error && loading && !data ? (
        <section className="panel empty-panel">
          <p className="eyebrow">読み込み中</p>
          <h3>候補を集計しています…</h3>
        </section>
      ) : null}

      {!error && data && filtered.length === 0 ? (
        <section className="panel empty-panel">
          <p className="eyebrow">{CANDIDATE_CATEGORY_LABELS[filter]}</p>
          <h3>該当する銘柄はありません</h3>
          <p>別の絞り込みを選ぶか、更新して最新の候補を確認してください。</p>
        </section>
      ) : null}

      {filtered.map((item) => (
        <CandidateCard
          key={item.code}
          item={item}
          isWatched={watched.includes(item.code)}
          onAnalyze={onAnalyze}
          onToggleWatch={toggleWatch}
        />
      ))}

      <MarketNews items={SAMPLE_MARKET_NEWS} />

      <p className="disclaimer candidate-disclaimer">{CANDIDATE_DISCLAIMER}</p>
    </div>
  )
}
