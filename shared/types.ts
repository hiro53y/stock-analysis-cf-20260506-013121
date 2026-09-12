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
  /** その銘柄自身の過去と比べた割安さ（履歴全体から計算） */
  valuation?: ValuationSnapshot | null
  /** 過去に安値圏へ下げたときの実績 */
  trackRecord?: TrackRecord | null
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
// 候補抽出（日本株全体から割安になった銘柄を探す）
// ──────────────────────────────────────────
export type CandidateCategory = 'buy' | 'watch' | 'trap' | 'skip'
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
 * 20日ボラティリティから見た想定保有期間の変動幅で算出する。
 */
export interface PriceTargets {
  /** 想定保有期間（TARGET_HORIZON_DAYS）の変動幅（標準偏差、比率） */
  horizonSigma: number
  targetPrice: number
  stopPrice: number
  /** 目標までの上昇率（比率） */
  targetUpside: number
  /** 損切りまでの下落率（比率、負値） */
  stopDownside: number
}

/**
 * その銘柄が過去に安値圏まで下げたとき、その後どうなったかの実績。
 *
 * winRate / averageReturn だけを見せると、地合いが良かっただけの銘柄を
 * 実力があると誤読させる。同じ期間・条件なしの平均（baseline）と、
 * その差（edge）を必ず併記する。
 */
export interface TrackRecord {
  samples: number
  horizonDays: number
  winRate: number
  averageReturn: number
  /** 保有期間中の最安値までの下落率（平均、負値） */
  averageDrawdown: number
  /** 条件なしで同じ期間を保有した場合の勝率 */
  baselineWinRate: number
  /** 条件なしで同じ期間を保有した場合の平均リターン */
  baselineReturn: number
  /** averageReturn - baselineReturn。これが実質的な上乗せ */
  edge: number
}

/** 「その銘柄自身の過去と比べてどれくらい安いか」 */
export interface ValuationSnapshot {
  /** 過去2年の終値分布での位置。0 = 最安値、1 = 最高値 */
  rangePercentile: number
  /** 200日移動平均からの乖離率 */
  ma200Deviation: number
  /** その乖離が過去2年の分布で下から何割か。小さいほど珍しく深い */
  ma200DeviationPercentile: number
  /** 52週高値からの下落率（負値） */
  drawdownFrom52wHigh: number
  /** 割安度スコア 0〜100。大きいほど割安 */
  score: number
  /** 計算に使った終値の本数 */
  sampleDays: number
}

/** 証券アナリストの投資判断の内訳（人数）。取れなかった区分は undefined */
export interface AnalystBreakdown {
  strongBuy?: number
  buy?: number
  hold?: number
  sell?: number
  strongSell?: number
}

/**
 * 証券アナリストのコンセンサス（みんかぶから取得）。
 *
 * `targetPrice` は**予想時点から1年後**の予想であり、本アプリ自身の目標
 * （約1か月・ボラティリティ基準）とは時間軸が違う。画面では必ず別扱いにする。
 * 分類やスコアには使わない（未検証の外部データで判定を動かさない）。
 */
export interface AnalystConsensus {
  /** 「2026/09/12」形式の時点 */
  asOf: string
  /** コンセンサス判断（買い / 中立 など） */
  judgement: string
  /** 平均目標株価（円、1年後予想） */
  targetPrice: number
  /** 現在株価に対する上昇余地（比率）。取れなければ undefined */
  upside?: number
  breakdown?: AnalystBreakdown
  /** 目標株価の推移（3ヶ月前 / 1ヶ月前 / 1週間前 / 最新） */
  trend?: Array<{ label: string; targetPrice: number }>
  /** 1株当り利益。アナリスト予想と会社予想の比較 */
  eps?: { analyst?: number; company?: number }
  /** 出典表示に使う */
  source: string
  /** 目標株価の時間軸の注記 */
  horizonNote: string
}

/**
 * Yahoo!ファイナンスの銘柄ページから取得する参考指標と業績評価。
 * 取得できなかった項目は undefined のままにし、推測で埋めない。
 */
export interface StockDetail {
  code: string
  name?: string
  /** PER（会社予想、倍） */
  per?: number
  /** PBR（実績、倍） */
  pbr?: number
  /** 配当利回り（会社予想、%） */
  dividendYield?: number
  /** 1株配当（会社予想、円） */
  dividendPerShare?: number
  eps?: number
  bps?: number
  /** ROE（実績、%） */
  roe?: number
  /** 自己資本比率（実績、%） */
  equityRatio?: number
  /** 時価総額（百万円） */
  marketCapMillionYen?: number
  /** 売買単位（株）。100株でない銘柄がある */
  sharesPerLot?: number
  /** 最低購入代金（円）。Yahoo の値を正とする */
  minimumPurchaseYen?: number
  /** 直近決算の要約 */
  earningsSummary?: string
  /** 決算の開示日時（ISO8601） */
  earningsDisclosedAt?: string
  /** 〈収益性〉〈安定性〉〈成長性〉の評価文 */
  health?: { profitability?: string; stability?: string; growth?: string }
  /** その銘柄が過去に安値圏で下げたときの実績 */
  trackRecord?: TrackRecord
  /** 証券アナリストのコンセンサス（カバーされていない・取得できない場合は undefined） */
  analyst?: AnalystConsensus
  /**
   * アナリスト情報の状態。
   * `none` は誰もカバーしていない（小型株では普通のこと）、
   * `unavailable` は取得・解析に失敗した、を表す。両者を画面で区別するために持つ。
   */
  analystCoverage?: 'covered' | 'none' | 'unavailable'
  /** 取得できなかった項目がある場合の注記 */
  partial: boolean
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
  /** RSI14。売られすぎ圏かどうかの判断に使う */
  rsi14: number
  /** 20日安値からの距離（比率）。安値更新中かどうか */
  distanceFromLow20: number
  downtrendRisk: number
  riskBand: RiskBand
  /** その銘柄自身の過去と比べた割安さ。履歴が足りなければ null */
  valuation: ValuationSnapshot | null
  lot: LotCost
  targets: PriceTargets
  reasons: string[]
  cautions: string[]
}

export interface CandidateCounts {
  buy: number
  watch: number
  trap: number
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
