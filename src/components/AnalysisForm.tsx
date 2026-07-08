import { useId } from 'react'
import type { AnalysisRequestPayload, MarketDataResponse, SymbolSearchHit } from '../../shared/types'
import { canonicalCode } from '../../shared/utils'
import { SymbolSearch } from './SymbolSearch'

interface AnalysisFormProps {
  value: AnalysisRequestPayload
  disabled: boolean
  preview: MarketDataResponse | null
  previewLoading: boolean
  onChange: (next: AnalysisRequestPayload) => void
  onSubmit: () => void
}

export function AnalysisForm({
  value,
  disabled,
  preview,
  previewLoading,
  onChange,
  onSubmit,
}: AnalysisFormProps) {
  const symbolId = useId()
  const marketId = useId()
  const buyId = useId()
  const sellId = useId()

  const handleSearchSelect = (hit: SymbolSearchHit) => {
    const code = canonicalCode(hit.symbol)
    const isJp = /\.T$/i.test(code)
    // 銘柄コード欄には JP は 4桁のみ（.T なし）、米国株はそのまま入れる
    onChange({ ...value, symbol: isJp ? code.replace(/\.T$/i, '') : code, market: isJp ? 'JP' : 'US' })
  }

  const yahooUrl = value.symbol
    ? `https://finance.yahoo.co.jp/search/?query=${encodeURIComponent(value.symbol)}`
    : 'https://finance.yahoo.co.jp/'

  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <p className="eyebrow">入力パネル</p>
        <h2>株式分析設定</h2>
        <p className="panel-copy">
          会社名でも検索できます。コードが分かる場合は直接入力してください。
        </p>
      </div>

      <SymbolSearch disabled={disabled} onSelect={handleSearchSelect} />

      <div className="form-group">
        <label htmlFor={symbolId}>銘柄コード</label>
        <input
          id={symbolId}
          value={value.symbol}
          placeholder="例: 7203 / AAPL"
          onChange={(event) => onChange({ ...value, symbol: event.target.value.toUpperCase() })}
          disabled={disabled}
        />
        <a className="yahoo-link" href={yahooUrl} target="_blank" rel="noopener noreferrer">
          Yahoo!ファイナンスでコードを調べる ↗
        </a>
      </div>

      <div className="form-group">
        <label htmlFor={marketId}>市場</label>
        <select
          id={marketId}
          value={value.market}
          onChange={(event) =>
            onChange({ ...value, market: event.target.value as AnalysisRequestPayload['market'] })
          }
          disabled={disabled}
        >
          <option value="auto">auto</option>
          <option value="JP">JP</option>
          <option value="US">US</option>
        </select>
      </div>

      <div className="threshold-grid">
        <div className="form-group">
          <label htmlFor={buyId}>買い閾値</label>
          <input
            id={buyId}
            type="number"
            min="0.5"
            max="0.95"
            step="0.05"
            value={value.buyThreshold}
            onChange={(event) =>
              onChange({ ...value, buyThreshold: Number(event.target.value) })
            }
            disabled={disabled}
          />
        </div>
        <div className="form-group">
          <label htmlFor={sellId}>売り閾値</label>
          <input
            id={sellId}
            type="number"
            min="0.05"
            max="0.5"
            step="0.05"
            value={value.sellThreshold}
            onChange={(event) =>
              onChange({ ...value, sellThreshold: Number(event.target.value) })
            }
            disabled={disabled}
          />
        </div>
      </div>

      <button className="primary-button" type="button" disabled={disabled} onClick={onSubmit}>
        {disabled ? '分析中...' : '分析を実行'}
      </button>

      <div className="market-preview">
        <p className="preview-label">銘柄プレビュー</p>
        {previewLoading ? (
          <p className="preview-value">銘柄情報を確認中...</p>
        ) : preview ? (
          <>
            <p className="preview-value">{preview.companyName}</p>
            <p className="preview-meta">
              {preview.normalizedSymbol} / {preview.market} / 最終日 {preview.latestDate.slice(0, 10)}
            </p>
          </>
        ) : (
          <p className="preview-meta">有効な銘柄コードを入力すると、ここに銘柄情報を表示します。</p>
        )}
      </div>

      <p className="disclaimer">
        ※ 本ツールは参考情報です。投資判断はご自身で行ってください。
      </p>
    </section>
  )
}
