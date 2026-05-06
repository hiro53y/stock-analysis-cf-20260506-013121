import { FORECAST_HORIZON_DAYS, MAX_PRICE_SERIES_POINTS } from '../constants'
import { formatDateLabel } from '../utils'
import type { OHLCVRow, PriceChartPoint } from '../types'

export interface FeatureTrainingRow {
  date: string
  close: number
  features: number[]
  targetReturn: number
  targetDirection: number
}

export interface FeatureLatestRow {
  date: string
  close: number
  features: number[]
}

export interface FeatureDataset {
  featureNames: string[]
  trainingRows: FeatureTrainingRow[]
  latestRow: FeatureLatestRow
  latestTrend: number
  priceSeries: PriceChartPoint[]
}

function rollingMean(values: number[], endIndex: number, window: number): number | null {
  if (endIndex < window - 1) return null
  let sum = 0
  for (let index = endIndex - window + 1; index <= endIndex; index += 1) {
    sum += values[index]
  }
  return sum / window
}

function rollingStd(values: number[], endIndex: number, window: number): number | null {
  const avg = rollingMean(values, endIndex, window)
  if (avg === null) return null
  let sum = 0
  for (let index = endIndex - window + 1; index <= endIndex; index += 1) {
    sum += (values[index] - avg) ** 2
  }
  return Math.sqrt(sum / window)
}

function rollingMax(values: number[], endIndex: number, window: number): number | null {
  if (endIndex < window - 1) return null
  return Math.max(...values.slice(endIndex - window + 1, endIndex + 1))
}

function rollingMin(values: number[], endIndex: number, window: number): number | null {
  if (endIndex < window - 1) return null
  return Math.min(...values.slice(endIndex - window + 1, endIndex + 1))
}

function calculateEma(values: number[], period: number): Array<number | null> {
  const multiplier = 2 / (period + 1)
  const results: Array<number | null> = Array.from({ length: values.length }, () => null)
  let previous: number | null = null

  for (let index = 0; index < values.length; index += 1) {
    if (index < period - 1) continue
    if (index === period - 1) {
      const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period
      previous = seed
      results[index] = seed
      continue
    }

    previous = (values[index] - previous!) * multiplier + previous!
    results[index] = previous
  }

  return results
}

function calculateRsi(closes: number[], period: number): Array<number | null> {
  const results: Array<number | null> = Array.from({ length: closes.length }, () => null)
  let gains = 0
  let losses = 0

  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1]
    gains += Math.max(delta, 0)
    losses += Math.max(-delta, 0)
  }

  let averageGain = gains / period
  let averageLoss = losses / period
  results[period] = averageLoss === 0 ? 1 : 1 - 1 / (1 + averageGain / averageLoss)

  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1]
    averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period
    averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period
    results[index] = averageLoss === 0 ? 1 : 1 - 1 / (1 + averageGain / averageLoss)
  }

  return results
}

function calculateAtr(rows: OHLCVRow[], period: number): Array<number | null> {
  const trueRanges = rows.map((row, index) => {
    if (index === 0) return row.high - row.low
    const previousClose = rows[index - 1].close
    return Math.max(
      row.high - row.low,
      Math.abs(row.high - previousClose),
      Math.abs(row.low - previousClose),
    )
  })

  const results: Array<number | null> = Array.from({ length: rows.length }, () => null)
  for (let index = period - 1; index < rows.length; index += 1) {
    const average =
      trueRanges.slice(index - period + 1, index + 1).reduce((sum, value) => sum + value, 0) /
      period
    results[index] = average
  }
  return results
}

export function buildFeatureDataset(rows: OHLCVRow[]): FeatureDataset {
  const closes = rows.map((row) => row.close)
  const highs = rows.map((row) => row.high)
  const lows = rows.map((row) => row.low)
  const volumes = rows.map((row) => row.volume)
  const returns = closes.map((close, index) => (index === 0 ? 0 : close / closes[index - 1] - 1))
  const ema12 = calculateEma(closes, 12)
  const ema26 = calculateEma(closes, 26)
  const rsi14 = calculateRsi(closes, 14)
  const atr14 = calculateAtr(rows, 14)

  const featureNames = [
    'return1d',
    'return5d',
    'return10d',
    'volumeChange1d',
    'smaGap5',
    'smaGap20',
    'smaTrend5to20',
    'emaGap12to26',
    'rsi14',
    'volatility20',
    'priceToHigh20',
    'priceToLow20',
    'volumeZ20',
    'trend3d',
    'atr14Pct',
  ]

  const trainingRows: FeatureTrainingRow[] = []
  let latestRow: FeatureLatestRow | null = null
  let latestTrend = 0

  for (let index = 26; index < rows.length; index += 1) {
    const close = closes[index]
    const return5 = index >= 5 ? close / closes[index - 5] - 1 : null
    const return10 = index >= 10 ? close / closes[index - 10] - 1 : null
    const volumeChange = index >= 1 ? volumes[index] / Math.max(volumes[index - 1], 1) - 1 : null
    const sma5 = rollingMean(closes, index, 5)
    const sma20 = rollingMean(closes, index, 20)
    const volatility20 = rollingStd(returns, index, 20)
    const high20 = rollingMax(highs, index, 20)
    const low20 = rollingMin(lows, index, 20)
    const volumeMean20 = rollingMean(volumes, index, 20)
    const volumeStd20 = rollingStd(volumes, index, 20)
    const trend3d = index >= 3 ? closes[index] / closes[index - 3] - 1 : null

    if (
      return5 === null ||
      return10 === null ||
      volumeChange === null ||
      sma5 === null ||
      sma20 === null ||
      volatility20 === null ||
      high20 === null ||
      low20 === null ||
      volumeMean20 === null ||
      volumeStd20 === null ||
      trend3d === null ||
      ema12[index] === null ||
      ema26[index] === null ||
      rsi14[index] === null ||
      atr14[index] === null
    ) {
      continue
    }

    const features = [
      returns[index],
      return5,
      return10,
      volumeChange,
      close / sma5 - 1,
      close / sma20 - 1,
      sma5 / sma20 - 1,
      ema12[index]! / ema26[index]! - 1,
      rsi14[index]! - 0.5,
      volatility20,
      close / high20 - 1,
      close / low20 - 1,
      volumeStd20 === 0 ? 0 : (volumes[index] - volumeMean20) / volumeStd20,
      trend3d,
      atr14[index]! / close,
    ]

    if (!features.every(Number.isFinite)) continue

    latestRow = { date: rows[index].date, close, features }
    latestTrend = sma5 > sma20 ? 1 : sma5 < sma20 ? -1 : 0

    if (index + FORECAST_HORIZON_DAYS >= rows.length) {
      continue
    }

    const targetReturn = closes[index + FORECAST_HORIZON_DAYS] / close - 1
    trainingRows.push({
      date: rows[index].date,
      close,
      features,
      targetReturn,
      targetDirection: targetReturn >= 0 ? 1 : 0,
    })
  }

  if (!latestRow) {
    throw new Error('特徴量を生成できませんでした。対象銘柄のデータが不足しています。')
  }

  const priceSeries = rows.slice(-MAX_PRICE_SERIES_POINTS).map((row) => ({
    date: row.date,
    label: formatDateLabel(row.date),
    close: row.close,
  }))

  return {
    featureNames,
    trainingRows,
    latestRow,
    latestTrend,
    priceSeries,
  }
}
