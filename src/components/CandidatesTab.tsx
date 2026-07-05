import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CANDIDATE_CATEGORY_LABELS,
  CANDIDATE_DISCLAIMER,
  SAMPLE_MARKET_NEWS,
} from '../../shared/constants'
import type {
  CandidateCategory,
  CandidateItem,
  CandidatesResponse,
  WatchlistEntry,
} from '../../shared/types'
import { fetchCandidates } from '../lib/api'
import { CandidateCard } from './CandidateCard'
import { MarketNews } from './MarketNews'

interface CandidatesTabProps {
  registry: WatchlistEntry[]
  onAnalyze: (code: string) => void
  onUnregister: (code: string) => void
}

type FilterKey = 'all' | CandidateCategory

const FILTER_ORDER: FilterKey[] = ['all', 'dip', 'rebound', 'danger', 'skip']

function filterLabel(key: FilterKey): string {
  return key === 'all' ? '登録銘柄' : CANDIDATE_CATEGORY_LABELS[key]
}

function formatTimestamp(iso: string): string {
  if (!iso) return '—'
  return iso.slice(0, 16).replace('T', ' ')
}

export function CandidatesTab({ registry, onAnalyze, onUnregister }: CandidatesTabProps) {
  const [data, setData] = useState<CandidatesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

  // 登録銘柄のコード集合（ソート結合）— 変化したときだけ再取得する
  const codesKey = useMemo(
    () => registry.map((entry) => entry.code).sort().join(','),
    [registry],
  )

  const loadCandidates = useCallback(async () => {
    const codes = codesKey ? codesKey.split(',') : []
    if (codes.length === 0) {
      setData({
        generatedAt: new Date().toISOString(),
        registeredCount: 0,
        counts: { dip: 0, rebound: 0, danger: 0, skip: 0 },
        candidates: [],
      })
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await fetchCandidates(codes)
      setData(response)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '候補の取得に失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [codesKey])

  useEffect(() => {
    // 登録銘柄が変わるたびに候補を取得（データ取得のための正当な副作用）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCandidates()
  }, [loadCandidates])

  // 登録銘柄の社名・業種でサーバー結果を上書き（ユーザー追加銘柄の表示を正しく）
  const nameByCode = useMemo(
    () => new Map(registry.map((entry) => [entry.code, entry])),
    [registry],
  )
  const candidates: CandidateItem[] = useMemo(() => {
    if (!data) return []
    return data.candidates.map((item) => {
      const entry = nameByCode.get(item.code)
      if (!entry) return item
      // 登録名がコードそのもの/未設定なら、サーバーが返した正式名を優先
      const name = entry.name && entry.name !== entry.code ? entry.name : item.name
      const sector = entry.sector && entry.sector !== '—' ? entry.sector : item.sector
      return { ...item, name, sector }
    })
  }, [data, nameByCode])

  const counts = data?.counts ?? { dip: 0, rebound: 0, danger: 0, skip: 0 }
  const totalCandidates = counts.dip + counts.rebound + counts.danger
  const filtered = filter === 'all' ? candidates : candidates.filter((item) => item.category === filter)

  const countFor = (key: FilterKey): number =>
    key === 'all' ? candidates.length : counts[key]

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
        {FILTER_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={`chip chip-${key}${key === filter ? ' active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {filterLabel(key)}
            <span className="chip-count">{countFor(key)}</span>
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

      {!error && data && registry.length === 0 ? (
        <section className="panel empty-panel">
          <p className="eyebrow">登録銘柄なし</p>
          <h3>登録銘柄がありません</h3>
          <p>「個別株調査」タブで銘柄を調べ、「登録銘柄に追加」すると、ここに表示されます。</p>
        </section>
      ) : null}

      {!error && data && registry.length > 0 && filtered.length === 0 ? (
        <section className="panel empty-panel">
          <p className="eyebrow">{filterLabel(filter)}</p>
          <h3>該当する銘柄はありません</h3>
          <p>別の絞り込みを選ぶか、更新して最新の状態を確認してください。</p>
        </section>
      ) : null}

      {filtered.map((item) => (
        <CandidateCard
          key={item.code}
          item={item}
          onAnalyze={onAnalyze}
          onUnregister={onUnregister}
        />
      ))}

      <MarketNews items={SAMPLE_MARKET_NEWS} />

      <p className="disclaimer candidate-disclaimer">{CANDIDATE_DISCLAIMER}</p>
    </div>
  )
}
