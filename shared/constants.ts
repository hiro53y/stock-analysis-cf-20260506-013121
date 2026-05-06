import type { AnalysisRequestPayload, FinalSignal, ModelId } from './types'

export const APP_NAME = '株式意思決定支援アプリ'
export const CACHE_VERSION = 'cf-2026-05-v1'
export const FORECAST_HORIZON_DAYS = 5
export const HISTORY_RANGE = '3y'
export const WALK_FORWARD_FOLDS = 5
export const MIN_TRAINING_ROWS = 120
export const MAX_PRICE_SERIES_POINTS = 120
export const MARKET_DATA_CACHE_TTL_SECONDS = 60 * 15
export const ANALYSIS_CACHE_TTL_SECONDS = 60 * 30
export const RATE_LIMIT_WINDOW_SECONDS = 60
export const RATE_LIMIT_MAX_REQUESTS = 8

export const DEFAULT_ANALYSIS_INPUT: AnalysisRequestPayload = {
  symbol: '7203',
  market: 'auto',
  buyThreshold: 0.6,
  sellThreshold: 0.4,
}

export const MODEL_LABELS: Record<ModelId, string> = {
  baseline: 'ベースライン',
  ar_trend: 'ARトレンド',
  direction_classifier: '方向分類',
  return_regressor: 'リターン回帰',
}

export const SIGNAL_LABELS: Record<FinalSignal, string> = {
  BUY: '買い',
  WATCH: '様子見',
  SELL: '売り',
  UNKNOWN: '判定不能',
}

export const FEATURE_LABELS: Record<string, string> = {
  return1d: '1日リターン',
  return5d: '5日リターン',
  return10d: '10日リターン',
  volumeChange1d: '出来高変化',
  smaGap5: '終値とSMA5の乖離',
  smaGap20: '終値とSMA20の乖離',
  smaTrend5to20: 'SMA5とSMA20の乖離',
  emaGap12to26: 'EMA12とEMA26の差',
  rsi14: 'RSI14',
  volatility20: '20日ボラティリティ',
  priceToHigh20: '20日高値からの距離',
  priceToLow20: '20日安値からの距離',
  volumeZ20: '出来高Zスコア',
  trend3d: '3日モメンタム',
  atr14Pct: 'ATR14比率',
}
