import { useEffect, useMemo, useRef, useState } from 'react'
import { APP_NAME } from '../shared/constants'
import type { AnalysisRequestPayload, WatchlistEntry } from '../shared/types'
import { canonicalCode } from '../shared/utils'
import { CandidatesTab } from './components/CandidatesTab'
import { GuideTab } from './components/GuideTab'
import { ResearchTab } from './components/ResearchTab'
import { useAnalysis } from './hooks/useAnalysis'
import { loadRegistry, saveRegistry } from './lib/api'

type MainTabKey = 'candidates' | 'research' | 'guide'

const mainTabLabels: Record<MainTabKey, string> = {
  candidates: '候補抽出',
  research: '個別株調査',
  guide: '使用方法',
}

const tabDescriptions: Record<MainTabKey, string> = {
  candidates:
    '日本株全体から本日値下がりした銘柄を集め、その銘柄自身の過去と比べて割安かどうかで「買い候補・監視・割安だが要注意」に仕分けます。',
  research: '銘柄コードまたは会社名から、株価・騰落率・分析結果を個別に確認できます。',
  guide: '用語の意味と分析結果の見方をまとめています。',
}

function readOfflineState(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.onLine === false
}

// ---- 埋め込み（くらしノート）連携 ----
// ?embed=1          見出しを省いて表示する
// ?registry=code:名前,code:名前  注目銘柄に加える（保有株など）
// ?symbol=8306      個別株調査を開いて自動で分析する
// ?tab=candidates|research|guide  最初に開くタブ
// 親ウィンドウからの postMessage: {type:'kurashi:registry', entries} / {type:'kurashi:analyze', symbol}
// 親ウィンドウへの postMessage: {type:'app:ready'} / {type:'stock:registry', entries}
function readParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

function isTrustedParentOrigin(origin: string): boolean {
  return (
    /^https:\/\/([a-z0-9-]+\.)*googleusercontent\.com$/.test(origin) ||
    origin === 'https://script.google.com' ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  )
}

function parseRegistryParam(raw: string | null): WatchlistEntry[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((part) => {
      const [code, ...rest] = part.split(':')
      return { code: canonicalCode(code.trim()), name: rest.join(':').trim() || code.trim(), sector: '' }
    })
    .filter((entry) => entry.code.length > 0)
    .slice(0, 40)
}

function mergeEntries(current: WatchlistEntry[], extra: WatchlistEntry[]): WatchlistEntry[] {
  const next = [...current]
  for (const entry of extra) {
    if (!next.some((item) => item.code === entry.code)) next.push(entry)
  }
  return next
}

function notifyParent(message: unknown): void {
  if (typeof window === 'undefined' || window.parent === window) return
  try {
    window.parent.postMessage(message, '*')
  } catch {
    // 親へ送れなくても動作は続ける
  }
}

function symbolToForm(base: AnalysisRequestPayload, raw: string): AnalysisRequestPayload {
  const code = canonicalCode(raw.trim())
  const isJp = /\.T$/i.test(code)
  return { ...base, symbol: code.replace(/\.T$/i, ''), market: isJp ? 'JP' : 'US' }
}

export default function App() {
  const params = useMemo(() => readParams(), [])
  const isEmbedded = params.get('embed') === '1'
  const initialTab = params.get('symbol') ? 'research' : (params.get('tab') as MainTabKey | null)
  const [mainTab, setMainTab] = useState<MainTabKey>(
    initialTab && initialTab in mainTabLabels ? initialTab : 'candidates',
  )
  const [registry, setRegistry] = useState<WatchlistEntry[]>(() => {
    const loaded = loadRegistry()
    const extra = parseRegistryParam(params.get('registry'))
    if (!extra.length) return loaded
    const merged = mergeEntries(loaded, extra)
    if (merged.length !== loaded.length) saveRegistry(merged)
    return merged
  })
  const [isOffline, setIsOffline] = useState(() => readOfflineState())
  const analysis = useAnalysis()
  const analysisRef = useRef(analysis)
  useEffect(() => {
    analysisRef.current = analysis
  })
  const registrySentRef = useRef(false)

  // 埋め込み時：URL の銘柄を自動で分析し、親からの指示（銘柄の受け渡し・注目銘柄）を受け付ける
  useEffect(() => {
    if (!isEmbedded) return
    const symbol = params.get('symbol')
    if (symbol) {
      const nextForm = symbolToForm(analysisRef.current.form, symbol)
      analysisRef.current.setForm(nextForm)
      void analysisRef.current.submit(nextForm)
    }
    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedParentOrigin(event.origin)) return
      const data = event.data as { type?: string; symbol?: string; entries?: Array<{ code?: string; name?: string }> } | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'kurashi:analyze' && typeof data.symbol === 'string' && data.symbol.trim()) {
        const nextForm = symbolToForm(analysisRef.current.form, data.symbol)
        analysisRef.current.setForm(nextForm)
        setMainTab('research')
        void analysisRef.current.submit(nextForm)
      }
      if (data.type === 'kurashi:registry' && Array.isArray(data.entries)) {
        const extra = data.entries
          .filter((entry) => typeof entry?.code === 'string' && entry.code.trim())
          .map((entry) => ({ code: canonicalCode(String(entry.code).trim()), name: String(entry.name || entry.code), sector: '' }))
        setRegistry((current) => {
          const merged = mergeEntries(current, extra)
          if (merged.length === current.length) return current
          saveRegistry(merged)
          return merged
        })
      }
    }
    window.addEventListener('message', handleMessage)
    notifyParent({ type: 'app:ready' })
    return () => window.removeEventListener('message', handleMessage)
  }, [isEmbedded, params])

  // 埋め込み時：注目銘柄が変わったら親（くらしノート）に知らせる（初回の読み込みは除く）
  useEffect(() => {
    if (!isEmbedded) return
    if (!registrySentRef.current) {
      registrySentRef.current = true
      return
    }
    notifyParent({ type: 'stock:registry', entries: registry.map((entry) => ({ code: entry.code.replace(/\.T$/i, ''), name: entry.name })) })
  }, [isEmbedded, registry])

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

  const registerStock = (entry: WatchlistEntry) => {
    const normalized: WatchlistEntry = { ...entry, code: canonicalCode(entry.code) }
    setRegistry((current) => {
      if (current.some((item) => item.code === normalized.code)) return current
      const next = [...current, normalized]
      saveRegistry(next)
      return next
    })
  }

  const unregisterStock = (code: string) => {
    const target = canonicalCode(code)
    setRegistry((current) => {
      const next = current.filter((item) => item.code !== target)
      saveRegistry(next)
      return next
    })
  }

  // 候補抽出タブの「詳しく分析」から個別株調査へ遷移し、銘柄コードを引き継いで自動実行する
  const handleAnalyzeCandidate = (code: string) => {
    const isJp = /\.T$/i.test(code)
    const nextForm: AnalysisRequestPayload = {
      ...analysis.form,
      symbol: code.replace(/\.T$/i, ''),
      market: isJp ? 'JP' : 'US',
    }
    analysis.setForm(nextForm)
    setMainTab('research')
    void analysis.submit(nextForm)
  }

  return (
    <div className={isEmbedded ? 'app-shell embedded' : 'app-shell'}>
      <header className="hero-shell">
        <h1>{APP_NAME}</h1>
        <p>日本株全体から本日安くなった銘柄を探し、気になる株を個別に調査できます。</p>
      </header>

      <div className="main-tab-bar" role="tablist" aria-label="メインタブ">
        {(Object.keys(mainTabLabels) as MainTabKey[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`main-tab-${tab}`}
            aria-selected={tab === mainTab}
            aria-controls={`main-panel-${tab}`}
            className={tab === mainTab ? 'main-tab active' : 'main-tab'}
            onClick={() => setMainTab(tab)}
          >
            {mainTabLabels[tab]}
          </button>
        ))}
      </div>

      <p className="tab-description">{tabDescriptions[mainTab]}</p>

      {/*
        候補抽出タブは切り替えても作り直さない。作り直すと、個別株調査から戻るたびに
        一覧の再取得・絞り込みと並び順のリセット・開いたカードの詳細の取り直しが起きる。
      */}
      <div
        role="tabpanel"
        id="main-panel-candidates"
        aria-labelledby="main-tab-candidates"
        hidden={mainTab !== 'candidates'}
      >
        <CandidatesTab
          registry={registry}
          onAnalyze={handleAnalyzeCandidate}
          onRegister={registerStock}
          onUnregister={unregisterStock}
        />
      </div>

      {mainTab !== 'candidates' ? (
        <div role="tabpanel" id={`main-panel-${mainTab}`} aria-labelledby={`main-tab-${mainTab}`}>
          {mainTab === 'guide' ? (
            <GuideTab />
          ) : (
            <ResearchTab
              analysis={analysis}
              registry={registry}
              isOffline={isOffline}
              onRegister={registerStock}
              onUnregister={unregisterStock}
            />
          )}
        </div>
      ) : null}
    </div>
  )
}
