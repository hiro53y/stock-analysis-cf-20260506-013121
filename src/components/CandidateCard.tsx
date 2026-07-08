import { RISK_BAND_LABELS } from '../../shared/constants'
import type { CandidateItem } from '../../shared/types'
import { formatCompactNumber, formatReturn } from '../../shared/utils'

interface CandidateCardProps {
  item: CandidateItem
  isRegistered: boolean
  onAnalyze: (code: string) => void
  onRegister: (item: CandidateItem) => void
  onUnregister: (code: string) => void
}

function returnClass(value: number): string {
  if (value > 0) return 'delta-up'
  if (value < 0) return 'delta-down'
  return 'delta-flat'
}

function formatShares(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value < 1 ? value.toFixed(2) : formatCompactNumber(Math.floor(value))
}

export function CandidateCard({
  item,
  isRegistered,
  onAnalyze,
  onRegister,
  onUnregister,
}: CandidateCardProps) {
  const isNegativeCard = item.category === 'danger'

  return (
    <article className={`candidate-card cat-${item.category}`}>
      <header className="candidate-head">
        <span className="candidate-rank">{item.rank}</span>
        <div className="candidate-title">
          <p className="candidate-name">{item.name}</p>
          <p className="candidate-code">{item.code}</p>
        </div>
        <span className={`candidate-tag tag-${item.category}`}>{item.categoryLabel}</span>
      </header>

      <div className="candidate-price">
        <span className="price-value">
          終値 {formatCompactNumber(item.close)}
          <small>円</small>
        </span>
        <div className="delta-row">
          <span>
            1日 <b className={returnClass(item.return1d)}>{formatReturn(item.return1d)}</b>
          </span>
          <span>
            5日 <b className={returnClass(item.return5d)}>{formatReturn(item.return5d)}</b>
          </span>
          <span>
            20日 <b className={returnClass(item.return20d)}>{formatReturn(item.return20d)}</b>
          </span>
        </div>
      </div>

      <div className="candidate-metrics">
        <div className="candidate-metric">
          <p className="metric-label">反発期待</p>
          <p className="metric-value val-positive">{item.reboundScore.toFixed(1)}</p>
        </div>
        <div className="candidate-metric">
          <p className="metric-label">下落継続リスク</p>
          <p className="metric-value">
            {item.downtrendRisk}
            <span className={`risk-band band-${item.riskBand}`}>{RISK_BAND_LABELS[item.riskBand]}</span>
          </p>
        </div>
        <div className="candidate-metric">
          <p className="metric-label">5万円購入時</p>
          <p className="metric-value">
            {formatShares(item.sharesFor50k)}
            <small>株</small>
          </p>
        </div>
        <div className="candidate-metric">
          <p className="metric-label">10%目標</p>
          <p className="metric-value">
            {formatCompactNumber(item.target10pct)}
            <small>円</small>
          </p>
        </div>
      </div>

      {item.reasons.length > 0 ? (
        <ul className="candidate-notes reasons">
          {item.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {item.cautions.length > 0 ? (
        <ul className={`candidate-notes cautions${isNegativeCard ? ' danger' : ''}`}>
          {item.cautions.map((caution) => (
            <li key={caution}>{caution}</li>
          ))}
        </ul>
      ) : null}

      <div className="candidate-actions">
        <button type="button" className="primary-button analyze-button" onClick={() => onAnalyze(item.code)}>
          分析
        </button>
        {isRegistered ? (
          <button
            type="button"
            className="secondary-button unregister-button"
            onClick={() => onUnregister(item.code)}
          >
            登録解除
          </button>
        ) : (
          <button
            type="button"
            className="secondary-button register-button"
            onClick={() => onRegister(item)}
          >
            登録
          </button>
        )}
      </div>
    </article>
  )
}
