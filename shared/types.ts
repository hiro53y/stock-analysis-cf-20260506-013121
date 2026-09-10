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

// ──────────────────────────────────────────
// 候補抽出（登録日本株から短期売買候補を整理）
// ──────────────────────────────────────────
export type CandidateCategory = 'dip' | 'rebound' | 'danger' | 'skip'
export type RiskBand = 'low' | 'mid' | 'high'

export interface WatchlistEntry {
  code: string
  name: string
  sector: string
}

/** 東証の市場区分。ランキング表の「東証PRM/STD/GRT」から取得する。 */
export type MarketSegment = 'プライム' | 'スタンダード' | 'グロース' | 'その他'

/** 1単元（原則100株）を買うのに必要な金額と、その手が届くかどうか。 */
export interface LotCost {
  /** 売買単位（株）。日本株は原則100 */
  sharesPerLot: number
  /** 1単元の必要資金（円） */
  costPerLot: number
  /** 目安予算で1単元買えるか */
  affordable: boolean
}

/**
 * 目標株価と損切り水準。固定の +10% ではなく、その銘柄の
 * 20日ボラティリティから見た5営業日の想定変動幅で算出する。
 */
export interface PriceTargets {
  /** 5営業日の想定変動幅（標準偏差、比率） */
  horizonSigma: number
  targetPrice: number
  stopPrice: number
  /** 目標までの上昇率（比率） */
  targetUpside: number
  /** 損切りまでの下落率（比率、負値） */
  stopDownside: number
}

/**
 * 同じ銘柄の過去データで同じ分類条件が成立した日を探し、
 * その後 5 営業日の値動きを集計した実績。標本が少なければ null。
 */
export interface HistoricalEdge {
  samples: number
  winRate: number
  averageReturn: number
  horizonDays: number
}

export interface CandidateItem {
  rank: number
  code: string
  name: string
  segment: MarketSegment
  category: CandidateCategory
  categoryLabel: string
  close: number
  return1d: number
  return5d: number
  return20d: number
  /** 当日の出来高（株） */
  volume: number
  /** 当日の売買代金（円）= 出来高 × 終値。流動性の目安 */
  turnover: number
  reboundScore: number
  downtrendRisk: number
  riskBand: RiskBand
  lot: LotCost
  targets: PriceTargets
  historicalEdge: HistoricalEdge | null
  reasons: string[]
  cautions: string[]
}

export interface CandidateCounts {
  dip: number
  rebound: number
  danger: number
  skip: number
}

/** 候補一覧と併せて返す、実データに基づく当日の市場サマリ。 */
export interface MarketSummary {
  /** ランキングから発見した銘柄数 */
  scanned: number
  /** そのうち当日下落していた銘柄数 */
  declining: number
  /** 詳細分析した銘柄数 */
  analyzed: number
  /** 下落銘柄の平均下落率（比率、負値） */
  averageDecline: number
  /** 取得を途中で打ち切った場合 true（subrequest 予算超過など） */
  partial: boolean
}

export interface CandidatesResponse {
  generatedAt: string
  registeredCount: number
  counts: CandidateCounts
  summary: MarketSummary
  candidates: CandidateItem[]
}

export interface SymbolSearchHit {
  symbol: string
  name: string
  exchange: string
}

export interface SymbolSearchResponse {
  query: string
  results: SymbolSearchHit[]
}
