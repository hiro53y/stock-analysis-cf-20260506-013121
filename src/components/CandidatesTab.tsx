import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CANDIDATE_CATEGORY_LABELS, CANDIDATE_DISCLAIMER } from '../../shared/constants'
import type {
  CandidateCategory,
  CandidateItem,
  CandidatesResponse,
  SymbolSearchHit,
  WatchlistEntry,
} from '../../shared/types'
import { canonicalCode, formatReturn } from '../../shared/utils'
import { fetchCandidates } from '../lib/api'
import { CandidateCard } from './CandidateCard'
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
  if (key === 'all') return 'すべて'
  if (key === 'registered') return '登録銘柄'
  return CANDIDATE_CATEGORY_LABELS[key]
}

function formatTimestamp(iso: string): string {
  if (!iso) return '—'
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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

  // 最新のリクエストだけを反映するためのカウンタ（古い応答の追い越しを無視）
  const requestIdRef = useRef(0)

  const loadCandidates = useCallback(async () => {
    // 登録銘柄を渡す（空でも可）。サーバーは市場全体の本日値下がり銘柄とユニオンして返す。
    const codes = codesKey ? codesKey.split(',') : []
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    try {
      const response = await fetchCandidates(codes)
      if (requestIdRef.current !== requestId) return // 後発のリクエストが走っているので破棄
      setData(response)
    } catch (loadError) {
      if (requestIdRef.current !== requestId) return
      setError(loadError instanceof Error ? loadError.message : '候補の取得に失敗しました。')
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [codesKey])

  useEffect(() => {
    // 登録銘柄が変わるたびに候補を取得（データ取得のための正当な副作用）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCandidates()
  }, [loadCandidates])

  // 登録銘柄の社名でサーバー結果を上書き、登録判定用の集合も作る
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
      return { ...item, name }
    })
  }, [data, registryByCode])

  const isRegistered = useCallback(
    (code: string) => registrySet.has(canonicalCode(code)),
    [registrySet],
  )

  const counts = data?.counts ?? { dip: 0, rebound: 0, danger: 0, skip: 0 }
  const summary = data?.summary
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
    onRegister({ code: canonicalCode(item.code), name: item.name, sector: '—' })
  }

  return (
    <div className="candidates-tab">
      <section className="panel candidate-summary">
        <div className="summary-top">
          <h2 className="summary-title">本日の候補</h2>
          <button
            type="button"
            className="refresh-button"
            onClick={() => void loadCandidates()}
            disabled={loading}
          >
            {loading ? '更新中…' : '↻ 更新'}
          </button>
        </div>

        {/* 集計結果は実データのみ。取得できていない値は「—」を出し、数字を作らない。 */}
        <dl className="market-summary" aria-live="polite">
          <div className="market-stat">
            <dt>走査した銘柄</dt>
            <dd>{summary ? summary.scanned.toLocaleString('ja-JP') : '—'}</dd>
          </div>
          <div className="market-stat">
            <dt>本日値下がり</dt>
            <dd>{summary ? summary.declining.toLocaleString('ja-JP') : '—'}</dd>
          </div>
          <div className="market-stat">
            <dt>平均下落率</dt>
            <dd className="delta-down">
              {summary && summary.declining > 0 ? formatReturn(summary.averageDecline) : '—'}
            </dd>
          </div>
          <div className="market-stat">
            <dt>詳細分析</dt>
            <dd>{summary ? summary.analyzed.toLocaleString('ja-JP') : '—'}</dd>
          </div>
        </dl>

        <p className="summary-updated">
          最終更新 {formatTimestamp(data?.generatedAt ?? '')}
          {summary?.partial ? '（取得を一部省略しています）' : null}
        </p>
      </section>

      <section className="panel register-search">
        <p className="register-search-title">銘柄を検索して登録</p>
        <p className="register-search-hint">
          会社名で検索して「登録銘柄」に追加できます。登録した銘柄は候補に入らなくても必ず分析されます。
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
            aria-pressed={key === filter}
            className={`chip chip-${key}${key === filter ? ' active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {filterLabel(key)}
            <span className="chip-count">{countFor(key)}</span>
          </button>
        ))}
      </nav>

      {error ? (
        <section className="panel error-panel" role="alert">
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

      {filtered.length > 0 ? (
        <div className="candidate-list">
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
        </div>
      ) : null}

      <p className="disclaimer candidate-disclaimer">{CANDIDATE_DISCLAIMER}</p>
    </div>
  )
}
