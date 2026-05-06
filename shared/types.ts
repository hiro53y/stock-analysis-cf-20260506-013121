export type MarketCode = 'auto' | 'JP' | 'US'
export type ResolvedMarket = 'JP' | 'US'
export type FinalSignal = 'BUY' | 'WATCH' | 'SELL' | 'UNKNOWN'
export type JobStatus = 'queued' | 'running' | 'completed' | 'error'
export type SummaryCardTone = 'positive' | 'negative' | 'neutral' | 'accent'
export type ModelId =
  | 'baseline'
  | 'ar_trend'
  | 'direction_classifier'
  | 'return_regressor'

export interface AnalysisRequestPayload {
  symbol: string
  market: MarketCode
  buyThreshold: number
  sellThreshold: number
}

export interface OHLCVRow {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface MarketDataResponse {
  symbol: string
  normalizedSymbol: string
  companyName: string
  market: ResolvedMarket
  latestDate: string
  rows: OHLCVRow[]
}

export interface SummaryCardData {
  id: string
  label: string
  value: string
  subText: string
  tone: SummaryCardTone
}

export interface PriceChartPoint {
  date: string
  label: string
  close: number
}

export interface ForecastChartPoint {
  date: string
  label: string
  actual?: number
  predicted?: number
  forecast: boolean
}

export interface FeatureContribution {
  feature: string
  score: number
  direction: 'positive' | 'negative' | 'neutral'
  valueText: string
}

export interface ModelResult {
  modelId: ModelId
  label: string
  status: 'ok' | 'error'
  predictedReturn: number | null
  upProbability: number | null
  recentBacktestScore: number | null
  errorMessage?: string
}

export interface BacktestFold {
  foldIndex: number
  trainSize: number
  testSize: number
  directionalAccuracy: number
  maeReturn: number
  score: number
}

export interface BacktestModelSummary {
  modelId: ModelId
  label: string
  directionalAccuracy: number
  maeReturn: number
  recentScore: number
  foldCount: number
  errorMessage?: string
}

export interface AnalysisResult {
  analysisId: string
  request: AnalysisRequestPayload
  generatedAt: string
  symbol: string
  normalizedSymbol: string
  companyName: string
  market: ResolvedMarket
  latestDataDate: string
  finalSignal: FinalSignal
  finalSignalLabel: string
  upProbability: number
  expectedReturn: number
  agreementScore: number
  recentBacktestScore: number
  summaryCards: SummaryCardData[]
  priceSeries: PriceChartPoint[]
  forecastSeries: ForecastChartPoint[]
  modelResults: ModelResult[]
  backtestSummary: BacktestModelSummary[]
  backtestFolds: Partial<Record<ModelId, BacktestFold[]>>
  featureImportance: FeatureContribution[]
  localContributions: FeatureContribution[]
  rationale: string[]
  riskFlags: string[]
  progressSteps: string[]
}

export interface AnalysisJobRecord {
  analysisId: string
  cacheKey: string
  dispatchKey?: string
  status: JobStatus
  progress: number
  progressMessage: string
  createdAt: string
  updatedAt: string
  cached: boolean
  request: AnalysisRequestPayload
  symbol: string
  normalizedSymbol?: string
  market?: ResolvedMarket
  result?: AnalysisResult
  error?: string
}

export interface AnalysisCreateResponse {
  analysisId: string
  status: JobStatus
  cached: boolean
  result?: AnalysisResult
}

export interface AnalysisStatusResponse {
  status: JobStatus
  progress: number
  progressMessage: string
  cached: boolean
  result?: AnalysisResult
  error?: string
}
