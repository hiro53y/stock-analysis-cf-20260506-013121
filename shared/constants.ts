import type {
  AnalysisRequestPayload,
  CandidateCategory,
  FinalSignal,
  ModelId,
  RiskBand,
  WatchlistEntry,
} from './types'

export const APP_NAME = '株式意思決定支援アプリ'
export const CACHE_VERSION = 'cf-2026-09-v5'
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
// Cloudflare Workers の subrequest 予算
// ──────────────────────────────────────────
// Workers は 1 リクエストあたりの subrequest 数に上限がある（無料プラン 50 / 有料 1000）。
// fetch() だけでなく Cache API の match/put も 1 回ずつ数えられるため、
// 外部取得 1 件あたり最大 3 subrequest を消費する。
// 上限に達すると Cloudflare 側で "Too many subrequests" となり 502 になるため、
// アプリ側で先に打ち切って「集まった分だけ返す」ようにする。
export const SUBREQUEST_COST_PER_FETCH = 3
export const SUBREQUEST_BUDGET = 40

// ──────────────────────────────────────────
// 候補抽出（日本株全体のランキングから発見）
// ──────────────────────────────────────────
export const CAPITAL_GAINS_TAX_RATE = 0.20315 // 日本の上場株式譲渡益課税
export const SAMPLE_BUDGET_YEN = 500000 // 「この金額で1単元買えるか」の判定に使う目安額
export const SHARES_PER_LOT = 100 // 日本株の売買単位（単元株）。原則100株

// 一次選抜: ランキング HTML から株価・前日比・出来高まで取得する（1ページ50件）
export const RANKING_ROWS_PER_PAGE = 50
export const RANKING_DOWN_PAGES = 6 // 値下がり率ランキング（本日安くなった株）= 最大300銘柄
export const RANKING_VOLUME_PAGES = 2 // 出来高ランキング（流動性のある主力株）= 最大100銘柄

// 二次分析: 一次選抜の上位のみ spark で株価履歴を取得する
// spark は 1 リクエスト約20銘柄が上限のため、SHORTLIST_SIZE / SPARK_BATCH_CHUNK がリクエスト数になる
export const SPARK_BATCH_CHUNK = 20
export const SHORTLIST_SIZE = 60 // 履歴を取得して詳細分析する銘柄数（= 3 リクエスト）
// 「その銘柄自身の過去と比べて安いか」を見るには年単位の履歴が要る。
// spark は 20銘柄 × 2年分を 1 リクエストで返すため、6か月から延ばしても取得回数は増えない。
export const SPARK_HISTORY_RANGE = '2y'

// ──────────────────────────────────────────
// 割安さの計測
// ──────────────────────────────────────────
export const MA_LONG_PERIOD = 200 // 長期移動平均（営業日）
export const WEEKS52_DAYS = 250 // 52週 ≒ 250営業日
export const VALUATION_MIN_DAYS = 250 // これ未満の履歴では割安さを判定しない
// 分布を数えるループの間引き幅。60銘柄×2年を全件回すと CPU 上限に触れるため。
// 実測で全件計算との差はパーセンタイル1ポイント未満。
export const VALUATION_SAMPLE_STEP = 5
// RSI は末尾の値しか使わないので、全期間ではなくこの本数だけで逐次計算する
export const RSI_WINDOW_DAYS = 60
// 52週高値からこれだけ下げていれば「下落率の観点では最大限に割安」とみなす
export const DRAWDOWN_FULL_CHEAP = 0.4
// 過去2年の終値分布でこの割合以下なら「安値圏」
export const CHEAP_RANGE_PERCENTILE = 0.3
// 52週高値からこれ以上下げている銘柄は、短期的に下げ止まって見えても「要注意」に回す。
// 半値以下まで売られた銘柄が安いのは、たいてい相応の理由がある（バリュートラップ）。
// 候補から消すのではなく、ラベルで区別して利用者に判断させる。
export const EXTREME_DRAWDOWN = -0.5

// ──────────────────────────────────────────
// 過去実績（銘柄詳細でのみ計算する）
// ──────────────────────────────────────────
export const HISTORICAL_WARMUP_DAYS = 200 // 分布が安定するまで判定に使わない
export const PERCENTILE_BUCKETS = 256 // 累積カウント用の量子化バケット数
// 隣接日は保有期間がほぼ重なり独立した観測にならないため、標本を間引く
export const HISTORICAL_SAMPLE_STEP = 2

// 一次選抜の内訳。売買代金上位（流動性のある主力株）と下落率上位の両方を拾う
export const SHORTLIST_BY_TURNOVER = 30
export const SHORTLIST_BY_DECLINE = 30
// 売買代金がこれ未満の銘柄は、個人でも板が薄く実際には売買しにくいため候補から外す
export const MIN_TURNOVER_YEN = 50_000_000

export const CANDIDATE_PER_CATEGORY = 12 // 各カテゴリの表示上限
export const CANDIDATES_CACHE_TTL_SECONDS = 60 * 10 // 候補一覧の鮮度
export const CANDIDATES_STALE_TTL_SECONDS = 60 * 60 * 6 // 再計算に失敗しても出す許容範囲

// ──────────────────────────────────────────
// 分類のしきい値
// ──────────────────────────────────────────
// 数値の根拠は docs/spec.md を参照。テストで境界値を固定している。
export const DANGER_RISK_THRESHOLD = 65 // downtrendRisk がこれ以上なら下落継続リスクが高い
export const DANGER_DROP_5D = -0.07 // 5日で -7% 以上下げていれば危険寄り
export const NEW_LOW_TOLERANCE = 0.005 // 20日安値からこの範囲内なら「安値更新中」
// 売られすぎ圏の目安。理由文の生成に使う
export const REBOUND_RSI_CEILING = 45
export const UPTREND_DRAWDOWN_LIMIT = -0.02 // 20日騰落がこれ以上なら「基調は維持」とみなす
export const RISK_BAND_HIGH = 65
export const RISK_BAND_MID = 40

// 目標株価・損切り水準は「20日ボラティリティから見た想定変動幅」で出す。
// 固定 +10% のような根拠のない数字は使わない。
export const TARGET_SIGMA_MULTIPLIER = 1.5
export const STOP_SIGMA_MULTIPLIER = 1.0
// 想定保有期間は数週間〜数ヶ月。20営業日（約1か月）を基準にする。
export const TARGET_HORIZON_DAYS = 20

// 簡易バックテスト: 同じ銘柄の過去データで同条件が出た日を探し、その後の値動きを集計する
export const HISTORICAL_LOOKFORWARD_DAYS = 20
export const HISTORICAL_MIN_SAMPLES = 5 // 標本がこれ未満なら実績を表示しない

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
  buy: '買い候補',
  watch: '監視',
  trap: '割安だが要注意',
  skip: '見送り',
}

export const CANDIDATE_CATEGORY_HINTS: Record<CandidateCategory, string> = {
  buy: '安値圏まで下げ、下げ止まりの兆しがある',
  watch: '安値圏だが、まだ下げている最中。下げ止まりを待つ',
  trap: '52週高値から半値以下。安いのには相応の理由がある可能性',
  skip: '安値圏ではない（今日下がっただけ）',
}

export const RISK_BAND_LABELS: Record<RiskBand, string> = {
  low: '低',
  mid: '中',
  high: '高',
}

export const CANDIDATE_DISCLAIMER =
  'この候補は投資助言ではありません。売買判断の前に、決算、適時開示、出来高、地合い、損切り条件を確認してください。'

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
