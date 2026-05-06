import {
  FORECAST_HORIZON_DAYS,
  MIN_TRAINING_ROWS,
} from '../constants'
import { formatDateLabel, formatProbability, formatReturn, formatSignal, nextBusinessDays } from '../utils'
import type {
  AnalysisRequestPayload,
  AnalysisResult,
  BacktestFold,
  FinalSignal,
  ForecastChartPoint,
  MarketDataResponse,
  ModelId,
} from '../types'
import { buildFeatureDataset } from './features'
import { chooseExplainableModel, getModelOutcomes } from './models'

interface SignalDecision {
  finalSignal: FinalSignal
  rationale: string[]
  riskFlags: string[]
}

function buildSignalDecision(input: {
  upProbability: number
  expectedReturn: number
  agreementScore: number
  backtestScore: number
  trend: number
  request: AnalysisRequestPayload
  activeModelCount: number
}): SignalDecision {
  const rationale = [
    `・上昇確率: ${formatProbability(input.upProbability)}`,
    `・期待リターン（${FORECAST_HORIZON_DAYS}営業日先）: ${formatReturn(input.expectedReturn)}`,
    `・モデル合意度: ${formatProbability(input.agreementScore)}`,
    `・バックテスト方向精度: ${formatProbability(input.backtestScore)}`,
    `・短期トレンド: ${
      input.trend > 0 ? '上向き（SMA5 > SMA20）' : input.trend < 0 ? '下向き（SMA5 < SMA20）' : '判定不能'
    }`,
  ]
  const riskFlags: string[] = []

  if (input.backtestScore < 0.52) {
    riskFlags.push('バックテスト精度が低い（過去データへの適合が不十分な可能性があります）')
  }
  if (input.agreementScore < 0.55) {
    riskFlags.push('モデル間の合意度が低い（予測にばらつきがあります）')
  }
  if (input.activeModelCount < 3) {
    riskFlags.push('一部モデルが失敗しました。結果は限定的に解釈してください。')
  }

  if (
    input.upProbability >= input.request.buyThreshold &&
    input.expectedReturn > 0.01 &&
    input.trend >= 0 &&
    input.agreementScore >= 0.5
  ) {
    return {
      finalSignal: 'BUY',
      rationale: ['【買い寄り】以下の条件がすべて揃っています。', ...rationale],
      riskFlags,
    }
  }

  if (
    input.upProbability <= input.request.sellThreshold ||
    input.expectedReturn < -0.01 ||
    (input.trend < 0 && input.agreementScore >= 0.55)
  ) {
    return {
      finalSignal: 'SELL',
      rationale: ['【売り/警戒寄り】以下の条件のいずれかが成立しています。', ...rationale],
      riskFlags,
    }
  }

  return {
    finalSignal: 'WATCH',
    rationale: ['【様子見】判断材料が混在しており、明確な方向感が出ていません。', ...rationale],
    riskFlags,
  }
}

function buildForecastSeries(lastDate: string, lastClose: number, expectedReturn: number) {
  const nextDates = nextBusinessDays(lastDate, FORECAST_HORIZON_DAYS)
  const base = Math.max(0.0001, 1 + expectedReturn)
  const stepReturn = Math.pow(base, 1 / FORECAST_HORIZON_DAYS) - 1
  const series: ForecastChartPoint[] = [
    {
      date: lastDate,
      label: formatDateLabel(lastDate),
      actual: lastClose,
      predicted: lastClose,
      forecast: false,
    },
  ]

  let cursor = lastClose
  for (const date of nextDates) {
    cursor *= 1 + stepReturn
    series.push({
      date,
      label: formatDateLabel(date),
      predicted: cursor,
      forecast: true,
    })
  }

  return series
}

export function analyzeMarketData(input: {
  analysisId: string
  request: AnalysisRequestPayload
  marketData: MarketDataResponse
}): AnalysisResult {
  const dataset = buildFeatureDataset(input.marketData.rows)
  if (dataset.trainingRows.length < MIN_TRAINING_ROWS) {
    throw new Error('分析に必要な学習データが不足しています。')
  }

  const outcomes = getModelOutcomes(dataset.featureNames, dataset.trainingRows, dataset.latestRow)
  const successful = outcomes.filter(
    (outcome) =>
      outcome.result.status === 'ok' &&
      typeof outcome.result.predictedReturn === 'number' &&
      typeof outcome.result.upProbability === 'number' &&
      typeof outcome.result.recentBacktestScore === 'number',
  )

  if (successful.length === 0) {
    throw new Error('モデルの集約に失敗しました。データ不足またはモデルエラーが原因の可能性があります。')
  }

  const weights = successful.map((outcome) => Math.max(outcome.result.recentBacktestScore ?? 0, 0.05))
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  const expectedReturn = successful.reduce(
    (sum, outcome, index) => sum + (outcome.result.predictedReturn ?? 0) * weights[index],
    0,
  ) / weightTotal
  const upProbability = successful.reduce(
    (sum, outcome, index) => sum + (outcome.result.upProbability ?? 0) * weights[index],
    0,
  ) / weightTotal
  const finalDirection = expectedReturn >= 0 ? 1 : 0
  const agreementScore =
    successful.reduce((sum, outcome, index) => {
      const direction = (outcome.result.predictedReturn ?? 0) >= 0 ? 1 : 0
      return sum + (direction === finalDirection ? weights[index] : 0)
    }, 0) / weightTotal
  const recentBacktestScore =
    successful.reduce(
      (sum, outcome, index) => sum + (outcome.result.recentBacktestScore ?? 0) * weights[index],
      0,
    ) / weightTotal

  const signalDecision = buildSignalDecision({
    upProbability,
    expectedReturn,
    agreementScore,
    backtestScore: recentBacktestScore,
    trend: dataset.latestTrend,
    request: input.request,
    activeModelCount: successful.length,
  })
  const explanation = chooseExplainableModel(outcomes, dataset.latestRow.features)
  const forecastSeries = buildForecastSeries(dataset.latestRow.date, dataset.latestRow.close, expectedReturn)
  const backtestSummary = outcomes.map((outcome) => outcome.summary)
  const backtestFolds = outcomes.reduce<Partial<Record<ModelId, BacktestFold[]>>>(
    (accumulator, outcome) => {
      accumulator[outcome.result.modelId] = outcome.folds
      return accumulator
    },
    {},
  )

  return {
    analysisId: input.analysisId,
    request: input.request,
    generatedAt: new Date().toISOString(),
    symbol: input.request.symbol,
    normalizedSymbol: input.marketData.normalizedSymbol,
    companyName: input.marketData.companyName,
    market: input.marketData.market,
    latestDataDate: input.marketData.latestDate,
    finalSignal: signalDecision.finalSignal,
    finalSignalLabel: formatSignal(signalDecision.finalSignal),
    upProbability,
    expectedReturn,
    agreementScore,
    recentBacktestScore,
    summaryCards: [
      {
        id: 'up-probability',
        label: '上昇確率',
        value: formatProbability(upProbability),
        subText: `${FORECAST_HORIZON_DAYS}営業日先`,
        tone: upProbability >= input.request.buyThreshold ? 'positive' : 'accent',
      },
      {
        id: 'expected-return',
        label: '期待リターン',
        value: formatReturn(expectedReturn),
        subText: `${FORECAST_HORIZON_DAYS}営業日先`,
        tone: expectedReturn >= 0 ? 'positive' : 'negative',
      },
      {
        id: 'agreement-score',
        label: 'モデル合意度',
        value: formatProbability(agreementScore),
        subText: '方向一致率',
        tone: agreementScore >= 0.6 ? 'accent' : 'neutral',
      },
      {
        id: 'backtest-score',
        label: 'バックテスト精度',
        value: formatProbability(recentBacktestScore),
        subText: '直近スコア',
        tone: recentBacktestScore >= 0.55 ? 'accent' : 'neutral',
      },
      {
        id: 'final-signal',
        label: '最終判定',
        value: formatSignal(signalDecision.finalSignal),
        subText: `${successful.length}/4 モデル使用`,
        tone:
          signalDecision.finalSignal === 'BUY'
            ? 'positive'
            : signalDecision.finalSignal === 'SELL'
              ? 'negative'
              : 'neutral',
      },
    ],
    priceSeries: dataset.priceSeries,
    forecastSeries,
    modelResults: outcomes.map((outcome) => outcome.result),
    backtestSummary,
    backtestFolds,
    featureImportance: explanation.featureImportance,
    localContributions: explanation.localContributions,
    rationale: signalDecision.rationale,
    riskFlags: signalDecision.riskFlags,
    progressSteps: ['データ取得', '特徴量生成', 'モデル学習', 'バックテスト', '説明可能性計算', '完了'],
  }
}
