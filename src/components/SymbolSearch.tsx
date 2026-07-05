import { useEffect, useId, useState } from 'react'
import type { MarketCode, SymbolSearchHit } from '../../shared/types'
import { fetchSymbolSearch } from '../lib/api'

interface SymbolSearchProps {
  disabled?: boolean
  onSelect: (code: string, market: MarketCode) => void
}

function toCodeAndMarket(symbol: string): { code: string; market: MarketCode } {
  if (symbol.toUpperCase().endsWith('.T')) {
    return { code: symbol.replace(/\.T$/i, ''), market: 'JP' }
  }
  return { code: symbol, market: 'US' }
}

export function SymbolSearch({ disabled, onSelect }: SymbolSearchProps) {
  const inputId = useId()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SymbolSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      // 入力が短いときは候補をクリア（外部データ同期のための副作用）
      /* eslint-disable react-hooks/set-state-in-effect */
      setResults([])
      setLoading(false)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }

    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true)
        const response = await fetchSymbolSearch(trimmed, controller.signal)
        if (!active) return
        setResults(response.results)
        setOpen(true)
      } catch (searchError) {
        if (searchError instanceof DOMException && searchError.name === 'AbortError') {
          return
        }
        if (!active) return
        setResults([])
      } finally {
        if (active) setLoading(false)
      }
    }, 400)

    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  const handleSelect = (hit: SymbolSearchHit) => {
    const { code, market } = toCodeAndMarket(hit.symbol)
    onSelect(code, market)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div className="form-group symbol-search">
      <label htmlFor={inputId}>会社名で検索</label>
      <input
        id={inputId}
        value={query}
        placeholder="例: トヨタ / ソニー / Apple"
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />

      {open && (loading || results.length > 0) ? (
        <ul className="search-suggestions" role="listbox">
          {loading ? (
            <li className="search-status">検索中…</li>
          ) : (
            results.map((hit) => (
              <li key={hit.symbol}>
                <button type="button" className="search-option" onClick={() => handleSelect(hit)}>
                  <span className="search-name">{hit.name}</span>
                  <span className="search-symbol">
                    {hit.symbol}
                    {hit.exchange ? ` · ${hit.exchange}` : ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {open && !loading && query.trim().length >= 2 && results.length === 0 ? (
        <ul className="search-suggestions" role="listbox">
          <li className="search-status">該当する銘柄が見つかりませんでした</li>
        </ul>
      ) : null}
    </div>
  )
}
