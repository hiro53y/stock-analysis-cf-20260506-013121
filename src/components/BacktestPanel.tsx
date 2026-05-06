import { useMemo, useState } from 'react'
import type { AnalysisResult, ModelId } from '../../shared/types'

interface BacktestPanelProps {
  result: AnalysisResult
}

export function BacktestPanel({ result }: BacktestPanelProps) {
  const firstModel = result.backtestSummary.find((item) => item.foldCount > 0)?.modelId ?? 'baseline'
  const [selectedModel, setSelectedModel] = useState<ModelId>(firstModel)
  const activeModel = result.backtestSummary.some((item) => item.modelId === selectedModel)
    ? selectedModel
    : firstModel

  const summary = useMemo(
    () => result.backtestSummary.find((item) => item.modelId === activeModel),
    [activeModel, result.backtestSummary],
  )
  const folds = result.backtestFolds[activeModel] ?? []

  return (
    <div className="tab-stack">
      <section className="panel">
        <div className="panel-heading compact">
          <p className="eyebrow">バックテスト</p>
          <h3>walk-forward 5分割</h3>
        </div>
        <div className="backtest-toolbar">
          <label>
            モデル:
            <select
              value={activeModel}
              onChange={(event) => setSelectedModel(event.target.value as ModelId)}
            >
              {result.backtestSummary.map((item) => (
                <option key={item.modelId} value={item.modelId}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="metric-pill">方向精度: {summary ? `${(summary.directionalAccuracy * 100).toFixed(1)}%` : '---'}</div>
          <div className="metric-pill">直近スコア: {summary ? `${(summary.recentScore * 100).toFixed(1)}%` : '---'}</div>
        </div>

        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fold</th>
                <th>学習件数</th>
                <th>検証件数</th>
                <th>方向精度</th>
                <th>MAE</th>
                <th>スコア</th>
              </tr>
            </thead>
            <tbody>
              {folds.map((fold) => (
                <tr key={fold.foldIndex}>
                  <td>{fold.foldIndex + 1}</td>
                  <td>{fold.trainSize}</td>
                  <td>{fold.testSize}</td>
                  <td>{(fold.directionalAccuracy * 100).toFixed(1)}%</td>
                  <td>{fold.maeReturn.toFixed(4)}</td>
                  <td>{(fold.score * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
