import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { computeLotCost, computePriceTargets, dailyVolatility } from '../../shared/analysis/targets'
import {
  CAPITAL_GAINS_TAX_RATE,
  SAMPLE_BUDGET_YEN,
  TARGET_HORIZON_DAYS,
} from '../../shared/constants'
import type { AnalysisResult } from '../../shared/types'
import { formatCompactNumber, formatReturn, formatYenScale } from '../../shared/utils'
import { SummaryCards } from './SummaryCards'

interface OverviewPanelProps {
  result: AnalysisResult
}

/**
 * 売買の目安。日本株は100株単位でしか買えないため「必要資金」を起点にする。
 * 目標株価はその銘柄自身のボラティリティから出す（固定の +10% は使わない）。
 */
function InvestmentMemo({ result }: { result: AnalysisResult }) {
  const closes = result.priceSeries.map((point) => point.close).filter(Number.isFinite)
  const latestClose = closes.at(-1) ?? 0
  if (!latestClose) return null

  const lot = computeLotCost(latestClose, SAMPLE_BUDGET_YEN)
  const targets = computePriceTargets(latestClose, dailyVolatility(closes, 20))
  const grossProfit = lot.costPerLot * targets.targetUpside
  const netProfit = grossProfit * (1 - CAPITAL_GAINS_TAX_RATE)

  return (
    <section className="panel memo-panel">
      <div className="panel-heading compact">
        <p className="eyebrow">売買の目安</p>
        <h3>1単元（{lot.sharesPerLot}株）で見た場合</h3>
      </div>
      <div className="memo-grid">
        <div className="memo-cell">
          <p className="memo-label">必要資金</p>
          <p className="memo-value">{formatYenScale(lot.costPerLot)}</p>
        </div>
        <div className="memo-cell">
          <p className="memo-label">目標株価（{TARGET_HORIZON_DAYS}営業日）</p>
          <p className="memo-value">
            {formatCompactNumber(targets.targetPrice)}
            <small>円</small>
            <span className="memo-sub delta-up">{formatReturn(targets.targetUpside)}</span>
          </p>
        </div>
        <div className="memo-cell">
          <p className="memo-label">損切り目安</p>
          <p className="memo-value">
            {formatCompactNumber(targets.stopPrice)}
            <small>円</small>
            <span className="memo-sub delta-down">{formatReturn(targets.stopDownside)}</span>
          </p>
        </div>
        <div className="memo-cell">
          <p className="memo-label">目標到達時の税引後利益</p>
          <p className="memo-value val-positive">{formatYenScale(netProfit)}</p>
        </div>
      </div>
      <p className="memo-note">
        ※ 目標・損切りは直近20日のボラティリティから求めた{TARGET_HORIZON_DAYS}営業日の想定変動幅（±
        {(targets.horizonSigma * 100).toFixed(1)}%）に基づく目安です。到達を保証するものではありません。
        利益は税率 {(CAPITAL_GAINS_TAX_RATE * 100).toFixed(3)}%（上場株式の譲渡益）で概算し、手数料等は含みません。
      </p>
    </section>
  )
}

export function OverviewPanel({ result }: OverviewPanelProps) {
  return (
    <div className="tab-stack">
      <SummaryCards cards={result.summaryCards} />

      <InvestmentMemo result={result} />

      <div className="chart-grid">
        <section className="panel chart-panel">
          <div className="panel-heading compact">
            <p className="eyebrow">価格チャート</p>
            <h3>直近推移</h3>
          </div>
          <div className="chart-shell">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={result.priceSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="label" stroke="#8aa1b2" />
                <YAxis stroke="#8aa1b2" />
                <Tooltip />
                <Line type="monotone" dataKey="close" stroke="#29a19c" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel chart-panel">
          <div className="panel-heading compact">
            <p className="eyebrow">予測チャート</p>
            <h3>5営業日先まで</h3>
          </div>
          <div className="chart-shell">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={result.forecastSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="label" stroke="#8aa1b2" />
                <YAxis stroke="#8aa1b2" />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="actual" name="実績" stroke="#f4efe6" strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="predicted" name="予測" stroke="#f27d42" strokeWidth={2.2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading compact">
          <p className="eyebrow">モデル別予測結果</p>
          <h3>モデル比較</h3>
        </div>
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>モデル</th>
                <th>期待リターン</th>
                <th>上昇確率</th>
                <th>BT精度</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {result.modelResults.map((row) => (
                <tr key={row.modelId}>
                  <td>{row.label}</td>
                  <td>{row.predictedReturn === null ? '---' : `${(row.predictedReturn * 100).toFixed(1)}%`}</td>
                  <td>{row.upProbability === null ? '---' : `${(row.upProbability * 100).toFixed(1)}%`}</td>
                  <td>
                    {row.recentBacktestScore === null
                      ? '---'
                      : `${(row.recentBacktestScore * 100).toFixed(1)}%`}
                  </td>
                  <td>{row.status === 'ok' ? '利用中' : row.errorMessage ?? '失敗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel narrative-panel">
        <div className="panel-heading compact">
          <p className="eyebrow">最終判定と理由</p>
          <h3>{result.finalSignalLabel}</h3>
        </div>
        <ul className="reason-list">
          {result.rationale.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {result.riskFlags.length > 0 ? (
          <div className="risk-box">
            <p className="risk-title">【注意点】</p>
            <ul className="reason-list">
              {result.riskFlags.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  )
}
