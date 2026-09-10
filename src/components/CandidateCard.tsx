import { RISK_BAND_LABELS, SAMPLE_BUDGET_YEN } from '../../shared/constants'
import type { CandidateItem } from '../../shared/types'
import {
  formatCompactNumber,
  formatReturn,
  formatShareCount,
  formatYenScale,
} from '../../shared/utils'

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

/**
 * 候補1件。既定では1行のサマリだけを見せ、詳細は開いたときに出す。
 *
 * 以前は全件を展開したまま縦に並べており、30件でページが1万3千pxを超えて
 * スマホでは事実上スクロールできなくなっていた。
 * details/summary を使うことで、キーボード操作と開閉状態の読み上げも標準で得られる。
 */
export function CandidateCard({
  item,
  isRegistered,
  onAnalyze,
  onRegister,
  onUnregister,
}: CandidateCardProps) {
  const { lot, targets, historicalEdge } = item

  return (
    <article className={`candidate-card cat-${item.category}`}>
      <details className="candidate-details">
        <summary className="candidate-summary-row">
          <span className={`candidate-tag tag-${item.category}`}>{item.categoryLabel}</span>

          <span className="candidate-identity">
            <span className="candidate-name">{item.name}</span>
            <span className="candidate-meta">
              {item.code.replace(/\.T$/, '')} · {item.segment}
            </span>
          </span>

          <span className="candidate-figures">
            <span className="candidate-close">{formatCompactNumber(item.close)}円</span>
            <span className={`candidate-delta ${returnClass(item.return1d)}`}>
              {formatReturn(item.return1d)}
            </span>
          </span>
        </summary>

        <div className="candidate-detail">
          <dl className="candidate-metrics">
            <div className="candidate-metric">
              <dt>5日 / 20日</dt>
              <dd>
                <b className={returnClass(item.return5d)}>{formatReturn(item.return5d)}</b>
                {' / '}
                <b className={returnClass(item.return20d)}>{formatReturn(item.return20d)}</b>
              </dd>
            </div>

            <div className="candidate-metric">
              <dt>反発期待 / 下落リスク</dt>
              <dd>
                {item.reboundScore}
                {' / '}
                {item.downtrendRisk}
                <span className={`risk-band band-${item.riskBand}`}>
                  {RISK_BAND_LABELS[item.riskBand]}
                </span>
              </dd>
            </div>

            <div className="candidate-metric">
              <dt>1単元（{lot.sharesPerLot}株）</dt>
              <dd>
                {formatYenScale(lot.costPerLot)}
                {lot.affordable ? null : (
                  <span className="metric-note">
                    {formatYenScale(SAMPLE_BUDGET_YEN)}超
                  </span>
                )}
              </dd>
            </div>

            <div className="candidate-metric">
              <dt>売買代金 / 出来高</dt>
              <dd>
                {formatYenScale(item.turnover)} / {formatShareCount(item.volume)}
              </dd>
            </div>

            <div className="candidate-metric">
              <dt>目標（5営業日）</dt>
              <dd>
                {formatCompactNumber(targets.targetPrice)}円
                <span className="metric-note delta-up">{formatReturn(targets.targetUpside)}</span>
              </dd>
            </div>

            <div className="candidate-metric">
              <dt>損切り目安</dt>
              <dd>
                {formatCompactNumber(targets.stopPrice)}円
                <span className="metric-note delta-down">{formatReturn(targets.stopDownside)}</span>
              </dd>
            </div>
          </dl>

          {historicalEdge ? (
            <p className="candidate-edge">
              この銘柄で同じ条件が出た過去{historicalEdge.samples}回のうち、
              {historicalEdge.horizonDays}営業日後に上昇していたのは{' '}
              <b>{(historicalEdge.winRate * 100).toFixed(0)}%</b>（平均{' '}
              <b className={returnClass(historicalEdge.averageReturn)}>
                {formatReturn(historicalEdge.averageReturn)}
              </b>
              ）。
            </p>
          ) : (
            <p className="candidate-edge muted">
              過去の同条件が少なく、実績は集計できていません。
            </p>
          )}

          {item.reasons.length > 0 ? (
            <ul className="candidate-notes reasons">
              {item.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}

          {item.cautions.length > 0 ? (
            <ul className={`candidate-notes cautions${item.category === 'danger' ? ' danger' : ''}`}>
              {item.cautions.map((caution) => (
                <li key={caution}>{caution}</li>
              ))}
            </ul>
          ) : null}

          <div className="candidate-actions">
            <button
              type="button"
              className="primary-button analyze-button"
              onClick={() => onAnalyze(item.code)}
            >
              詳しく分析
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
        </div>
      </details>
    </article>
  )
}
