import { describe, expect, it } from 'vitest'
import { analyzeMarketData } from './engine'
import type { MarketDataResponse, OHLCVRow } from '../types'

function buildRows(): OHLCVRow[] {
  const rows: OHLCVRow[] = []
  let close = 100

  for (let index = 0; index < 260; index += 1) {
    const drift = 0.0015
    const wave = Math.sin(index / 8) * 0.008
    const dailyReturn = drift + wave
    const nextClose = close * (1 + dailyReturn)

    rows.push({
      date: new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
      open: close * 0.995,
      high: Math.max(close, nextClose) * 1.01,
      low: Math.min(close, nextClose) * 0.99,
      close: nextClose,
      volume: 1_000_000 + index * 2_000,
    })

    close = nextClose
  }

  return rows
}

describe('analyzeMarketData', () => {
  it('分析結果DTOを返す', () => {
    const marketData: MarketDataResponse = {
      symbol: '7203',
      normalizedSymbol: '7203.T',
      companyName: 'テスト自動車',
      market: 'JP',
      latestDate: new Date(Date.UTC(2024, 8, 30)).toISOString(),
      rows: buildRows(),
    }

    const result = analyzeMarketData({
      analysisId: 'test-analysis',
      request: {
        symbol: '7203',
        market: 'JP',
        buyThreshold: 0.6,
        sellThreshold: 0.4,
      },
      marketData,
    })

    expect(result.summaryCards).toHaveLength(5)
    expect(result.modelResults).toHaveLength(4)
    expect(result.backtestSummary.some((item) => item.foldCount > 0)).toBe(true)
    expect(result.priceSeries.length).toBeGreaterThan(30)
    expect(result.forecastSeries.length).toBe(6)
    expect(['買い', '様子見', '売り']).toContain(result.finalSignalLabel)
  })
})
