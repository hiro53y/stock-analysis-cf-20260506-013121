import {
  CANDIDATE_CATEGORY_HINTS,
  RISK_BAND_LABELS,
  TARGET_HORIZON_DAYS,
} from '../../shared/constants'
import type { CandidateItem, StockDetail } from '../../shared/types'
import {
  formatCompactNumber,
  formatReturn,
  formatShareCount,
  formatYenScale,
} from '../../shared/utils'
import { ExternalLinkRow, StockDetailPanel } from './StockDetailPanel'

export type DetailState = 'idle' | 'loading' | 'error'

interface CandidateCardProps {
  item: CandidateItem
  isRegistered: boolean
  /** 親が保持している詳細。絞り込みを切り替えても保たれる */
  detail: StockDetail | null
  detailState: DetailState
  onOpen: (code: string) => void
  onAnalyze: (code: string) => void
  onRegister: (item: CandidateItem) => void
  onUnregister: (code: string) => void
}

function returnClass(value: number): string {
  if (value > 0) return 'delta-up'
  if (value < 0) return 'delta-down'
  return 'delta-flat'
}

/** パーセンタイルを「安値圏N%」の表現にする（0=最安値） */
function cheapLabel(percentile: number): string {
  return `安値圏 ${Math.round(percentile * 100)}%`
}

/**
 * 候補1件。既定では1行のサマリだけを見せ、詳細は開いたときに出す。
 *
 * サマリには当日騰落率だけでなく「その銘柄の過去2年でどれくらい安い位置か」を出す。
 * 割安株を探すのが目的なので、開かなくても安さが分かる必要がある。
 *
 * 参考指標・アナリスト評価・過去実績は、開いたときに1銘柄だけ取得する。
 * 取得結果は親（CandidatesTab）が持つ。カード内に持つと、絞り込みを切り替えて
 * カードがアンマウントされるたびに取得し直すことになる。
 */
export function CandidateCard({
  item,
  isRegistered,
  detail,
  detailState,
  onOpen,
  onAnalyze,
  onRegister,
  onUnregister,
}: CandidateCardProps) {
  const { lot, targets, valuation } = item

  // 単元株数が100株でない銘柄があるため、取得できたら Yahoo の値を正とする
  const purchaseCost = detail?.minimumPurchaseYen ?? lot.costPerLot
  const purchaseShares = detail?.sharesPerLot ?? lot.sharesPerLot

  return (
    <article className={`candidate-card cat-${item.category}`}>
      <details
        className="candidate-details"
        onToggle={(event) => {
          if ((event.currentTarget as HTMLDetailsElement).open) onOpen(item.code)
        }}
      >
        <summary className="candidate-summary-row">
          <span
            className={`candidate-tag tag-${item.category}`}
            title={CANDIDATE_CATEGORY_HINTS[item.category]}
          >
            {item.categoryLabel}
          </span>

          <span className="candidate-identity">
            <span className="candidate-name">{item.name}</span>
            <span className="candidate-meta">
              {item.code.replace(/\.T$/, '')}
              {/* ランキングに載っていない登録銘柄は市場区分が分からないので出さない */}
              {item.segment !== 'その他' ? ` · ${item.segment}` : ''}
            </span>
          </span>

          <span className="candidate-figures">
            <span className="candidate-close">{formatCompactNumber(item.close)}円</span>
            <span className="candidate-sub">
              <span className={returnClass(item.return1d)}>{formatReturn(item.return1d)}</span>
              {valuation ? (
                <span className="candidate-cheap">{cheapLabel(valuation.rangePercentile)}</span>
              ) : null}
            </span>
          </span>
        </summary>

        <div className="candidate-detail">
          {valuation ? (
            <section className="sheet-block">
              <h4 className="sheet-title">どれくらい安いか</h4>
              <div className="cheap-gauge">
                <div
                  className="cheap-gauge-fill"
                  style={{ width: `${Math.max(2, Math.round(valuation.rangePercentile * 100))}%` }}
                />
                <span className="cheap-gauge-label">
                  過去2年のレンジで下位 {Math.round(valuation.rangePercentile * 100)}%
                </span>
              </div>
              <dl className="candidate-metrics compact">
                <div className="candidate-metric">
                  <dt>200日線からの乖離</dt>
                  <dd>
                    <b className={returnClass(valuation.ma200Deviation)}>
                      {formatReturn(valuation.ma200Deviation)}
                    </b>
                    <span className="metric-note">
                      下位{Math.round(valuation.ma200DeviationPercentile * 100)}%の深さ
                    </span>
                  </dd>
                </div>
                <div className="candidate-metric">
                  <dt>52週高値から</dt>
                  <dd className={returnClass(valuation.drawdownFrom52wHigh)}>
                    {formatReturn(valuation.drawdownFrom52wHigh)}
                  </dd>
                </div>
              </dl>
            </section>
          ) : (
            <p className="sheet-note muted">履歴が足りず、割安さを判定できていません。</p>
          )}

          <section className="sheet-block">
            <h4 className="sheet-title">買うなら</h4>
            <dl className="candidate-metrics compact">
              <div className="candidate-metric">
                <dt>最低購入代金（{purchaseShares}株）</dt>
                <dd>{formatYenScale(purchaseCost)}</dd>
              </div>
              <div className="candidate-metric">
                <dt>目標（約1か月・{TARGET_HORIZON_DAYS}営業日）</dt>
                <dd>
                  {formatCompactNumber(targets.targetPrice)}円
                  <span className="metric-note delta-up">{formatReturn(targets.targetUpside)}</span>
                </dd>
              </div>
              <div className="candidate-metric">
                <dt>損切り目安</dt>
                <dd>
                  {formatCompactNumber(targets.stopPrice)}円
                  <span className="metric-note delta-down">
                    {formatReturn(targets.stopDownside)}
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="sheet-block">
            <h4 className="sheet-title">値動きの状態</h4>
            <dl className="candidate-metrics compact">
              <div className="candidate-metric">
                <dt>5日 / 20日</dt>
                <dd>
                  <b className={returnClass(item.return5d)}>{formatReturn(item.return5d)}</b>
                  {' / '}
                  <b className={returnClass(item.return20d)}>{formatReturn(item.return20d)}</b>
                </dd>
              </div>
              <div className="candidate-metric">
                <dt>RSI14 / 20日安値から</dt>
                <dd>
                  {item.rsi14.toFixed(0)}
                  {' / '}
                  {formatReturn(item.distanceFromLow20)}
                </dd>
              </div>
              <div className="candidate-metric">
                <dt>下落継続リスク</dt>
                <dd>
                  {item.downtrendRisk}
                  <span className={`risk-band band-${item.riskBand}`}>
                    {RISK_BAND_LABELS[item.riskBand]}
                  </span>
                </dd>
              </div>
              <div className="candidate-metric">
                <dt>売買代金 / 出来高</dt>
                <dd>
                  {/* 出来高はランキング表からしか取れない。載っていない登録銘柄は不明 */}
                  {item.volume > 0
                    ? `${formatYenScale(item.turnover)} / ${formatShareCount(item.volume)}`
                    : '—'}
                </dd>
              </div>
            </dl>
          </section>

          <StockDetailPanel
            detail={detail}
            state={detailState}
            currentPrice={item.close}
            onRetry={() => onOpen(item.code)}
          />

          <ExternalLinkRow code={item.code} />

          {item.reasons.length > 0 ? (
            <ul className="candidate-notes reasons">
              {item.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}

          {item.cautions.length > 0 ? (
            <ul className={`candidate-notes cautions${item.category === 'trap' ? ' danger' : ''}`}>
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
