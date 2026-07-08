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
  SymbolSearchHit,
  WatchlistEntry,
} from '../../shared/types'
import { canonicalCode } from '../../shared/utils'
import { fetchCandidates } from '../lib/api'
import { CandidateCard } from './CandidateCard'
import { MarketNews } from './MarketNews'
import { SymbolSearch } from './SymbolSearch'

interface CandidatesTabProps {
  registry: WatchlistEntry[]
  onAnalyze: (code: string) => void
  onRegister: (entry: WatchlistEntry) => void
  onUnregister: (code: string) => void
}

type FilterKey = 'all' | CandidateCategory | 'registered'

const FILTER_ORDER: FilterKey[] = ['all', 'dip', 'rebound', 'danger', 'registered']

function filterLabel(key: FilterKey): string {
  if (key === 'all') return '本日の候補'
  if (key === 'registered') return '登録銘柄'
  return CANDIDATE_CATEGORY_LABELS[key]
}

function formatTimestamp(iso: string): string {
  if (!iso) return '—'
  return iso.slice(0, 16).replace('T', ' ')
}

export function CandidatesTab({ registry, onAnalyze, onRegister, onUnregister }: CandidatesTabProps) {
  const [data, setData] = useState<CandidatesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

  // 登録銘柄のコード集合（正準化・ソート結合）— 変化したときだけ再取得する
  const codesKey = useMemo(
    () =>
      Array.from(new Set(registry.map((entry) => canonicalCode(entry.code))))
        .sort()
        .join(','),
    [registry],
  )

  const loadCandidates = useCallback(async () => {
    // 登録銘柄を渡す（空でも可）。サーバーは市場全体の本日値下がり銘柄とユニオンして返す。
    const codes = codesKey ? codesKey.split(',') : []
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

  // 登録銘柄の社名・業種でサーバー結果を上書き、登録判定用の集合も作る
  const registrySet = useMemo(
    () => new Set(registry.map((entry) => canonicalCode(entry.code))),
    [registry],
  )
  const registryByCode = useMemo(
    () => new Map(registry.map((entry) => [canonicalCode(entry.code), entry])),
    [registry],
  )
  const candidates: CandidateItem[] = useMemo(() => {
    if (!data) return []
    return data.candidates.map((item) => {
      const entry = registryByCode.get(canonicalCode(item.code))
      if (!entry) return item
      const name = entry.name && entry.name !== entry.code ? entry.name : item.name
      const sector = entry.sector && entry.sector !== '—' ? entry.sector : item.sector
      return { ...item, name, sector }
    })
  }, [data, registryByCode])

  const isRegistered = useCallback(
    (code: string) => registrySet.has(canonicalCode(code)),
    [registrySet],
  )

  const counts = data?.counts ?? { dip: 0, rebound: 0, danger: 0, skip: 0 }
  const totalCandidates = counts.dip + counts.rebound + counts.danger
  const registeredCandidates = useMemo(
    () => candidates.filter((item) => isRegistered(item.code)),
    [candidates, isRegistered],
  )

  const filtered =
    filter === 'all'
      ? candidates
      : filter === 'registered'
        ? registeredCandidates
        : candidates.filter((item) => item.category === filter)

  const countFor = (key: FilterKey): number => {
    if (key === 'all') return candidates.length
    if (key === 'registered') return registeredCandidates.length
    return counts[key]
  }

  const handleRegisterHit = (hit: SymbolSearchHit) => {
    onRegister({ code: canonicalCode(hit.symbol), name: hit.name, sector: '—' })
  }

  const handleRegisterCandidate = (item: CandidateItem) => {
    onRegister({ code: canonicalCode(item.code), name: item.name, sector: item.sector ?? '—' })
  }

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

        <p className="summary-lead">
          日本株全体から「本日値下がりした銘柄」を集め、押し目・反発・危険を自動で仕分けしています。
        </p>

        <div className="summary-stats">
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
          <div className="stat-cell">
            <span className="stat-label">登録銘柄</span>
            <span className="stat-value">{registry.length}</span>
          </div>
        </div>
        <p className="summary-updated">最終更新 {formatTimestamp(data?.generatedAt ?? '')}</p>
      </section>

      <section className="panel register-search">
        <p className="register-search-title">銘柄を検索して登録</p>
        <p className="register-search-hint">
          会社名で検索して「登録銘柄」に追加できます。登録すると下の「登録銘柄」で絞り込めます。
        </p>
        <SymbolSearch
          label="会社名または銘柄コードで検索"
          placeholder="例: 任天堂 / トヨタ / Apple"
          onSelect={handleRegisterHit}
        />
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
          <h3>本日の候補を集計しています…</h3>
        </section>
      ) : null}

      {!error && data && filter === 'registered' && registeredCandidates.length === 0 ? (
        <section className="panel empty-panel">
          <p className="eyebrow">登録銘柄</p>
          <h3>登録銘柄がありません</h3>
          <p>上の検索ボックスで会社名を検索し、「登録銘柄」に追加してください。</p>
        </section>
      ) : null}

      {!error && data && filter !== 'registered' && filtered.length === 0 ? (
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
          isRegistered={isRegistered(item.code)}
          onAnalyze={onAnalyze}
          onRegister={handleRegisterCandidate}
          onUnregister={onUnregister}
        />
      ))}

      <MarketNews items={SAMPLE_MARKET_NEWS} />

      <p className="disclaimer candidate-disclaimer">{CANDIDATE_DISCLAIMER}</p>
    </div>
  )
}
