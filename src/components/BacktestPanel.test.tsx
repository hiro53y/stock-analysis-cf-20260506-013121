import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AnalysisResult } from '../../shared/types'
import { BacktestPanel } from './BacktestPanel'

function createResult(modelIds: Array<'baseline' | 'ar_trend'>): AnalysisResult {
  const summary = modelIds.map((modelId, index) => ({
    modelId,
    label: modelId === 'baseline' ? 'ベースライン' : 'ARトレンド',
    directionalAccuracy: 0.6 + index * 0.1,
    maeReturn: 0.02 + index * 0.01,
    recentScore: 0.55 + index * 0.1,
    foldCount: 5,
  }))

  return {
    analysisId: 'analysis-1',
    request: {
      symbol: '7203',
      market: 'auto',
      buyThreshold: 0.6,
      sellThreshold: 0.4,
    },
    generatedAt: '2026-04-16T12:00:00.000Z',
    symbol: '7203',
    normalizedSymbol: '7203.T',
    companyName: 'トヨタ自動車',
    market: 'JP',
    latestDataDate: '2026-04-15T00:00:00.000Z',
    finalSignal: 'BUY',
    finalSignalLabel: '買い',
    upProbability: 0.7,
    expectedReturn: 0.04,
    agreementScore: 0.6,
    recentBacktestScore: 0.58,
    summaryCards: [],
    priceSeries: [],
    forecastSeries: [],
    modelResults: [],
    backtestSummary: summary,
    backtestFolds: {
      baseline: [
        {
          foldIndex: 0,
          trainSize: 100,
          testSize: 20,
          directionalAccuracy: 0.6,
          maeReturn: 0.02,
          score: 0.55,
        },
      ],
      ar_trend: modelIds.includes('ar_trend')
        ? [
            {
              foldIndex: 0,
              trainSize: 100,
              testSize: 20,
              directionalAccuracy: 0.7,
              maeReturn: 0.03,
              score: 0.65,
            },
          ]
        : [],
    },
    featureImportance: [],
    localContributions: [],
    rationale: [],
    riskFlags: [],
    progressSteps: [],
  }
}

describe('BacktestPanel', () => {
  it('結果更新で選択中モデルが存在しなくなった場合は先頭モデルへ戻す', () => {
    const { rerender } = render(<BacktestPanel result={createResult(['baseline', 'ar_trend'])} />)

    const select = screen.getByLabelText('モデル:') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'ar_trend' } })
    expect(select.value).toBe('ar_trend')

    rerender(<BacktestPanel result={createResult(['baseline'])} />)

    expect((screen.getByLabelText('モデル:') as HTMLSelectElement).value).toBe('baseline')
    expect(screen.getByText('方向精度: 60.0%')).toBeInTheDocument()
  })
})
