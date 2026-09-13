import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CANDIDATE_CATEGORY_LABELS, CANDIDATE_DISCLAIMER } from '../../shared/constants'
import type {
  CandidateCategory,
  CandidateItem,
  CandidatesResponse,
  StockDetail,
  SymbolSearchHit,
  WatchlistEntry,
} from '../../shared/types'
import { canonicalCode, formatReturn, isJapaneseStockCode } from '../../shared/utils'
import { fetchCandidates, fetchStockDetail } from '../lib/api'
import { CandidateCard, type DetailState } from './CandidateCard'
import { SymbolSearch } from './SymbolSearch'

interface CandidatesTabProps {
  registry: WatchlistEntry[]
  onAnalyze: (code: string) => void
  onRegister: (entry: WatchlistEntry) => void
  onUnregister: (code: string) => void
}

type FilterKey = 'all' | CandidateCategory | 'registered'
type SortKey = 'cheap' | 'affordable' | 'decline' | 'turnover'

const FILTER_ORDER: FilterKey[] = ['all', 'buy', 'watch', 'trap', 'skip', 'registered']

/** 並び順の選択肢。カテゴリをまたいで並べ替えられるようにする。 */
const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'cheap', label: '割安な順' },
  { key: 'affordable', label: '必要資金が少ない順' },
  { key: 'decline', label: '本日の下落が大きい順' },
  { key: 'turnover', label: '売買代金が多い順' },
]

/** 登録を続けて行ったときに、再取得を1回にまとめるための待ち時間 */
const REGISTRY_REFETCH_DELAY_MS = 600

/** 候補一覧は日本株専用なので、検索でも日本株だけを出す（参照を固定するためモジュール直下に置く） */
const acceptJapaneseStock = (hit: SymbolSearchHit) => isJapaneseStockCode(hit.symbol)

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
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sortCandidates(items: CandidateItem[], sort: SortKey): CandidateItem[] {
  const sorted = [...items]
  if (sort === 'affordable') {
    sorted.sort((a, b) => a.lot.costPerLot - b.lot.costPerLot)
  } else if (sort === 'decline') {
    sorted.sort((a, b) => a.return1d - b.return1d)
  } else if (sort === 'turnover') {
    sorted.sort((a, b) => b.turnover - a.turnover)
  } else {
    // 既定は割安な順。同点はサーバーが付けた rank（カテゴリ順）で安定させる
    sorted.sort((a, b) => {
      const diff = (b.valuation?.score ?? 0) - (a.valuation?.score ?? 0)
      return diff !== 0 ? diff : a.rank - b.rank
    })
  }
  return sorted
}

export function CandidatesTab({ registry, onAnalyze, onRegister, onUnregister }: CandidatesTabProps) {
  const [data, setData] = useState<CandidatesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [sort, setSort] = useState<SortKey>('cheap')

  // 銘柄詳細はカードではなくここで保持する。
  // カード内に持つと、絞り込みを切り替えてアンマウントされるたびに取得し直してしまう。
  const [details, setDetails] = useState<Record<string, StockDetail>>({})
  const [detailStates, setDetailStates] = useState<Record<string, DetailState>>({})
  const detailControllers = useRef(new Map<string, AbortController>())

  // 登録銘柄のうち候補一覧で扱える日本株のコード（正準化・重複除去・ソート済み）
  const registryCodes = useMemo(
    () =>
      Array.from(
        new Set(registry.map((entry) => canonicalCode(entry.code)).filter(isJapaneseStockCode)),
      ).sort(),
    [registry],
  )
  const registryKey = registryCodes.join(',')

  // 候補一覧では扱えない登録銘柄（米国株など、以前のバージョンで登録されたもの）
  const unsupportedRegistry = useMemo(
    () => registry.filter((entry) => !isJapaneseStockCode(entry.code)),
    [registry],
  )

  // 最新のリクエストだけを反映するためのカウンタ（古い応答の追い越しを無視）
  const requestIdRef = useRef(0)
  // 直近に成功した取得で、どの登録銘柄を含めて問い合わせたか
  const requestedCodesRef = useRef<Set<string> | null>(null)

  const loadCandidates = useCallback(async () => {
    const codes = registryKey ? registryKey.split(',') : []
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    try {
      const response = await fetchCandidates(codes)
      if (requestIdRef.current !== requestId) return // 後発のリクエストが走っているので破棄
      requestedCodesRef.current = new Set(codes)
      setData(response)
    } catch (loadError) {
      if (requestIdRef.current !== requestId) return
      setError(loadError instanceof Error ? loadError.message : '候補の取得に失敗しました。')
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [registryKey])

  const dataCodes = useMemo(
    () => new Set((data?.candidates ?? []).map((item) => item.code)),
    [data],
  )

  /**
   * 登録銘柄が変わったときの再取得。
   *
   * 以前は登録・解除のたびに毎回取得し直しており、続けて登録すると
   * サーバーのレート制限（1分8回）に達して一覧がエラーになっていた。
   * - 解除だけなら取得しない（画面側で表示を切り替えれば足りる）
   * - すでに一覧に出ている銘柄を登録した場合も取得しない
   * - 続けて登録したときは、待ち時間の間にまとめて1回だけ取得する
   */
  useEffect(() => {
    const requested = requestedCodesRef.current
    if (requested !== null) {
      const hasNewCode = registryCodes.some((code) => !requested.has(code) && !dataCodes.has(code))
      if (!hasNewCode) return
    }
    const timer = window.setTimeout(
      () => void loadCandidates(),
      requested === null ? 0 : REGISTRY_REFETCH_DELAY_MS,
    )
    return () => window.clearTimeout(timer)
  }, [registryCodes, dataCodes, loadCandidates])

  // 画面を離れるときに未完了の詳細取得を中断する
  useEffect(() => {
    const controllers = detailControllers.current
    return () => {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    }
  }, [])

  /** カードが開かれたときだけ、その銘柄の詳細を1回取得する */
  const loadDetail = useCallback(
    async (code: string) => {
      if (details[code] || detailStates[code] === 'loading') return

      detailControllers.current.get(code)?.abort()
      const controller = new AbortController()
      detailControllers.current.set(code, controller)

      setDetailStates((current) => ({ ...current, [code]: 'loading' }))
      try {
        const detail = await fetchStockDetail(code, controller.signal)
        setDetails((current) => ({ ...current, [code]: detail }))
        setDetailStates((current) => ({ ...current, [code]: 'idle' }))
      } catch (detailError) {
        if (detailError instanceof DOMException && detailError.name === 'AbortError') return
        setDetailStates((current) => ({ ...current, [code]: 'error' }))
      } finally {
        detailControllers.current.delete(code)
      }
    },
    [details, detailStates],
  )

  const registrySet = useMemo(() => new Set(registryCodes), [registryCodes])
  const registryByCode = useMemo(
    () => new Map(registry.map((entry) => [canonicalCode(entry.code), entry])),
    [registry],
  )

  const isRegistered = useCallback((code: string) => registrySet.has(canonicalCode(code)), [registrySet])

  const candidates: CandidateItem[] = useMemo(() => {
    if (!data) return []
    return (
      data.candidates
        // 「見送り」は登録銘柄だからこそ一覧にあるもの。解除されたら画面からも外す
        .filter((item) => item.category !== 'skip' || registrySet.has(item.code))
        .map((item) => {
          const entry = registryByCode.get(canonicalCode(item.code))
          if (!entry) return item
          const name = entry.name && entry.name !== entry.code ? entry.name : item.name
          return { ...item, name }
        })
    )
  }, [data, registrySet, registryByCode])

  const counts = useMemo(() => {
    const next = { buy: 0, watch: 0, trap: 0, skip: 0 }
    for (const item of candidates) next[item.category] += 1
    return next
  }, [candidates])
  const summary = data?.summary

  const registeredCandidates = useMemo(
    () => candidates.filter((item) => isRegistered(item.code)),
    [candidates, isRegistered],
  )

  // 登録しているのに一覧にまだ出ていない銘柄。取得待ちか、取得できなかったもの
  const pendingRegistered = useMemo(
    () =>
      registryCodes
        .filter((code) => !dataCodes.has(code))
        .map((code) => ({ code, name: registryByCode.get(code)?.name ?? code })),
    [registryCodes, dataCodes, registryByCode],
  )
  const failedCodes = new Set(data?.missingRegistered ?? [])

  const filtered = useMemo(() => {
    const base =
      filter === 'all'
        ? candidates
        : filter === 'registered'
          ? registeredCandidates
          : candidates.filter((item) => item.category === filter)
    return sortCandidates(base, sort)
  }, [candidates, registeredCandidates, filter, sort])

  const countFor = (key: FilterKey): number => {
    if (key === 'all') return candidates.length
    // 登録銘柄は「一覧に出た数」ではなく「登録している数」を出す
    if (key === 'registered') return registry.length
    return counts[key]
  }

  const handleRegisterHit = (hit: SymbolSearchHit) => {
    onRegister({ code: canonicalCode(hit.symbol), name: hit.name, sector: '—' })
  }

  const handleRegisterCandidate = (item: CandidateItem) => {
    onRegister({ code: canonicalCode(item.code), name: item.name, sector: '—' })
  }

  const showRegisteredNotes =
    filter === 'registered' && (pendingRegistered.length > 0 || unsupportedRegistry.length > 0)

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
          会社名か銘柄コードで検索して「登録銘柄」に追加できます。登録した銘柄は、割安でなくても・今日動いていなくても必ず表示されます（日本株のみ）。
        </p>
        <SymbolSearch
          label="会社名または銘柄コードで検索"
          placeholder="例: 任天堂 / トヨタ / 5451"
          accept={acceptJapaneseStock}
          onSelect={handleRegisterHit}
        />
      </section>

      <div className="list-controls">
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

        <div className="sort-bar">
          <label htmlFor="candidate-sort">並び順</label>
          <select
            id="candidate-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

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

      {!error && data && filter === 'registered' && registry.length === 0 ? (
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
          <p>
            相場が堅調な日は、安値圏まで下げた銘柄が出ないことがあります。
            「すべて」に切り替えるか、時間をおいて更新してください。
            登録した銘柄は割安でなくても「登録銘柄」に必ず表示されます。
          </p>
        </section>
      ) : null}

      {filtered.length > 0 ? (
        <div className="candidate-list">
          {filtered.map((item) => (
            <CandidateCard
              key={item.code}
              item={item}
              isRegistered={isRegistered(item.code)}
              detail={details[item.code] ?? null}
              detailState={detailStates[item.code] ?? 'idle'}
              onOpen={(code) => void loadDetail(code)}
              onAnalyze={onAnalyze}
              onRegister={handleRegisterCandidate}
              onUnregister={onUnregister}
            />
          ))}
        </div>
      ) : null}

      {showRegisteredNotes ? (
        <section className="panel registered-notes" aria-live="polite">
          {pendingRegistered.length > 0 ? (
            <ul className="registered-pending">
              {pendingRegistered.map(({ code, name }) => (
                <li key={code}>
                  <span>
                    <b>{name}</b> {code.replace(/\.T$/, '')}
                  </span>
                  <span className="sheet-note muted">
                    {failedCodes.has(code) && !loading
                      ? '株価を取得できませんでした（コードの誤りや上場廃止の可能性）'
                      : '取得しています…'}
                  </span>
                  {failedCodes.has(code) && !loading ? (
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => onUnregister(code)}
                    >
                      解除
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {unsupportedRegistry.length > 0 ? (
            <ul className="registered-pending">
              {unsupportedRegistry.map((entry) => (
                <li key={entry.code}>
                  <span>
                    <b>{entry.name}</b> {entry.code}
                  </span>
                  <span className="sheet-note muted">
                    日本株以外は候補一覧に表示できません（個別株調査タブでは分析できます）
                  </span>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => onUnregister(entry.code)}
                  >
                    解除
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <p className="disclaimer candidate-disclaimer">{CANDIDATE_DISCLAIMER}</p>
    </div>
  )
}
