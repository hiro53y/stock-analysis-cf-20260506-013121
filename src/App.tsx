import { useEffect, useState } from 'react'
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

export default function App() {
  const [mainTab, setMainTab] = useState<MainTabKey>('candidates')
  const [registry, setRegistry] = useState<WatchlistEntry[]>(() => loadRegistry())
  const [isOffline, setIsOffline] = useState(() => readOfflineState())
  const analysis = useAnalysis()

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
    <div className="app-shell">
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
