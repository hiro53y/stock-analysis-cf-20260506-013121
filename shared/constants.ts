import type {
  AnalysisRequestPayload,
  CandidateCategory,
  FinalSignal,
  MarketNewsItem,
  ModelId,
  RiskBand,
  WatchlistEntry,
} from './types'

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

// ──────────────────────────────────────────
// 候補抽出（登録日本株ユニバース）
// ──────────────────────────────────────────
export const CAPITAL_GAINS_TAX_RATE = 0.20315 // 日本の上場株式譲渡益課税
export const SAMPLE_BUDGET_YEN = 50000 // 5万円購入時の概算に使用

// 候補抽出は日本株全体の「本日の値下がり銘柄＋出来高上位」をランキングから発見して母集団にする
export const CANDIDATE_UNIVERSE_SIZE = 300 // 発見する銘柄数の上限（できるだけ幅広く走査）
export const RANKING_DOWN_PAGES = 6 // 値下がり率ランキングを辿るページ数（1ページ約43件）
export const RANKING_VOLUME_PAGES = 2 // 出来高ランキング（大型株を含める）を辿るページ数
export const SPARK_BATCH_CHUNK = 20 // spark 一括取得の上限（約20超で HTTP 400）

export const DEFAULT_JP_WATCHLIST: WatchlistEntry[] = [
  { code: '9983.T', name: 'ファーストリテイリング', sector: '小売' },
  { code: '7203.T', name: 'トヨタ自動車', sector: '自動車' },
  { code: '8306.T', name: '三菱UFJフィナンシャル・グループ', sector: '銀行' },
  { code: '6758.T', name: 'ソニーグループ', sector: '電気機器' },
  { code: '6501.T', name: '日立製作所', sector: '電気機器' },
  { code: '9984.T', name: 'ソフトバンクグループ', sector: '情報・通信' },
  { code: '8035.T', name: '東京エレクトロン', sector: '電気機器' },
  { code: '6098.T', name: 'リクルートホールディングス', sector: 'サービス' },
  { code: '4063.T', name: '信越化学工業', sector: '化学' },
  { code: '8058.T', name: '三菱商事', sector: '卸売' },
  { code: '6902.T', name: 'デンソー', sector: '輸送用機器' },
  { code: '5803.T', name: 'フジクラ', sector: '非鉄金属' },
]

export const CANDIDATE_CATEGORY_LABELS: Record<CandidateCategory, string> = {
  dip: '押し目候補',
  rebound: '反発候補',
  danger: '危険な下落',
  skip: '見送り',
}

export const RISK_BAND_LABELS: Record<RiskBand, string> = {
  low: '低',
  mid: '中',
  high: '高',
}

export const CANDIDATE_DISCLAIMER =
  'この候補は投資助言ではありません。売買判断の前に、決算、適時開示、出来高、地合い、損切り条件を確認してください。'

// 市場ニュースは外部フィードを持たないため静的サンプルを表示
export const SAMPLE_MARKET_NEWS: MarketNewsItem[] = [
  {
    id: 'news-1',
    title: '日経平均続伸、銀行株しっかり',
    summary: '米雇用統計を前に買い優勢。金融株が指数を下支え。',
    time: '15:25',
    tag: 'market',
  },
  {
    id: 'news-2',
    title: '円相場は小幅な動き',
    summary: '対ドルでは一進一退。引き続き米金利動向に注目。',
    time: '14:40',
    tag: 'fx',
  },
  {
    id: 'news-3',
    title: '半導体関連は一部軟調',
    summary: '米ハイテク株安を受け、売りが優勢となる場面も。',
    time: '13:55',
    tag: 'sector',
  },
]

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
