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
import { CAPITAL_GAINS_TAX_RATE, SAMPLE_BUDGET_YEN } from '../../shared/constants'
import type { AnalysisResult } from '../../shared/types'
import { formatCompactNumber } from '../../shared/utils'
import { SummaryCards } from './SummaryCards'

interface OverviewPanelProps {
  result: AnalysisResult
}

function InvestmentMemo({ result }: { result: AnalysisResult }) {
  const latestClose =
    result.priceSeries.at(-1)?.close ??
    result.forecastSeries.filter((point) => typeof point.actual === 'number').at(-1)?.actual ??
    0

  if (!latestClose) return null

  const shares = SAMPLE_BUDGET_YEN / latestClose
  const target10pct = latestClose * 1.1
  const grossProfit = SAMPLE_BUDGET_YEN * 0.1
  const netProfit = grossProfit * (1 - CAPITAL_GAINS_TAX_RATE)
  const sharesText = shares < 1 ? shares.toFixed(2) : formatCompactNumber(Math.floor(shares))

  return (
    <section className="panel memo-panel">
      <div className="panel-heading compact">
        <p className="eyebrow">投資メモ</p>
        <h3>5万円で買った場合の目安</h3>
      </div>
      <div className="memo-grid">
        <div className="memo-cell">
          <p className="memo-label">5万円購入時</p>
          <p className="memo-value">
            {sharesText}
            <small>株</small>
          </p>
        </div>
        <div className="memo-cell">
          <p className="memo-label">10%上昇時の目標株価</p>
          <p className="memo-value">
            {formatCompactNumber(target10pct)}
            <small>円</small>
          </p>
        </div>
        <div className="memo-cell">
          <p className="memo-label">税引前利益目安</p>
          <p className="memo-value val-positive">
            {formatCompactNumber(grossProfit)}
            <small>円</small>
          </p>
        </div>
        <div className="memo-cell">
          <p className="memo-label">税引後利益目安</p>
          <p className="memo-value val-positive">
            {formatCompactNumber(netProfit)}
            <small>円</small>
          </p>
        </div>
      </div>
      <p className="memo-note">
        ※ 税率 {(CAPITAL_GAINS_TAX_RATE * 100).toFixed(3)}%（上場株式の譲渡益）で概算。手数料等は含みません。
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
