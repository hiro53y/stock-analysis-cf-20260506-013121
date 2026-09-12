import {
  CANDIDATE_CATEGORY_LABELS,
  CHEAP_RANGE_PERCENTILE,
  DANGER_DROP_5D,
  DANGER_RISK_THRESHOLD,
  EXTREME_DRAWDOWN,
  NEW_LOW_TOLERANCE,
  REBOUND_RSI_CEILING,
  RISK_BAND_HIGH,
  RISK_BAND_MID,
  RSI_WINDOW_DAYS,
  SAMPLE_BUDGET_YEN,
} from '../constants'
import type {
  CandidateCategory,
  CandidateCounts,
  CandidateItem,
  MarketSegment,
  RiskBand,
  ValuationSnapshot,
} from '../types'
import { clamp, formatReturn } from '../utils'
import { computeLotCost, computePriceTargets, dailyVolatility } from './targets'
import { computeValuation } from './valuation'

export interface CandidateEntry {
  code: string
  name: string
  segment: MarketSegment
}

/** ランキング表から取れる当日の実績値。spark の履歴より当日値として信頼できる。 */
export interface CandidateToday {
  close: number
  return1d: number
  volume: number
}

export interface CandidateSource {
  entry: CandidateEntry
  today: CandidateToday
  /** spark 由来の日次終値（古い→新しい順、2年分） */
  closes: number[]
}

interface CandidateMetrics {
  close: number
  return1d: number
  return5d: number
  return20d: number
  sma5: number
  sma20: number
  sma25: number
  rsi14: number
  distanceFromHigh20: number
  distanceFromLow20: number
  volatility20: number
}

function meanOfLast(values: number[], window: number): number {
  const slice = values.slice(-window)
  if (slice.length === 0) return 0
  return slice.reduce((sum, value) => sum + value, 0) / slice.length
}

function returnOver(closes: number[], lookback: number): number {
  const last = closes[closes.length - 1]
  const index = Math.max(0, closes.length - 1 - lookback)
  const base = closes[index]
  if (!base) return 0
  return last / base - 1
}

/**
 * Wilder 方式の RSI（0〜100）を末尾値で返す。
 *
 * 履歴が2年（約480本）あっても末尾の値しか使わないため、直近 RSI_WINDOW_DAYS 本だけで
 * 逐次計算する。全期間を回すと 60銘柄で CPU 時間が跳ね上がり、
 * Cloudflare の1リクエスト10ms（無料プラン）に収まらなくなる。
 * Wilder の平滑化は指数的に収束するので、60本あれば末尾値は十分に安定する。
 */
export function computeRsi(closes: number[], period = 14, window = RSI_WINDOW_DAYS): number {
  const n = closes.length
  const start = Math.max(1, n - window)
  if (n - start <= period) return 50

  let gains = 0
  let losses = 0
  for (let index = start; index < start + period; index += 1) {
    const delta = closes[index] - closes[index - 1]
    gains += Math.max(delta, 0)
    losses += Math.max(-delta, 0)
  }
  let averageGain = gains / period
  let averageLoss = losses / period

  for (let index = start + period; index < n; index += 1) {
    const delta = closes[index] - closes[index - 1]
    averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period
    averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period
  }

  if (averageLoss === 0) return 100
  return 100 - 100 / (1 + averageGain / averageLoss)
}

/**
 * spark の履歴の末尾を、ランキング由来の当日終値で置き換える。
 *
 * spark とランキングで当日の値がずれると「本日値下がり」と説明しながら
 * 当日プラスの銘柄を出す、といった矛盾が起きるため、当日値は一箇所に揃える。
 */
export function alignCloses(closes: number[], todayClose: number): number[] {
  const clean = closes.filter((value) => Number.isFinite(value) && value > 0)
  if (clean.length === 0) return [todayClose]
  return [...clean.slice(0, -1), todayClose]
}

function buildMetrics(closes: number[], today: CandidateToday): CandidateMetrics {
  const window20 = closes.slice(-20)
  const high20 = Math.max(...window20)
  const low20 = Math.min(...window20)
  const close = today.close

  return {
    close,
    // 当日騰落率はランキング表の実績値を使う（spark の当日バーは未確定のことがある）
    return1d: today.return1d,
    return5d: returnOver(closes, 5),
    return20d: returnOver(closes, 20),
    sma5: meanOfLast(closes, 5),
    sma20: meanOfLast(closes, 20),
    sma25: meanOfLast(closes, 25),
    rsi14: computeRsi(closes),
    distanceFromHigh20: high20 === 0 ? 0 : close / high20 - 1,
    distanceFromLow20: low20 === 0 ? 0 : close / low20 - 1,
    volatility20: dailyVolatility(closes, 20),
  }
}

export function computeDowntrendRisk(m: CandidateMetrics): number {
  return Math.round(
    clamp(
      30 +
        clamp(-m.return5d * 100, 0, 20) * 1.8 +
        clamp(-m.return20d * 100, 0, 25) * 0.8 +
        (m.distanceFromLow20 <= 0.01 ? 15 : 0) +
        clamp(m.volatility20 * 100, 0, 5) * 2 -
        (m.sma5 > m.sma20 ? 15 : 0),
      0,
      100,
    ),
  )
}

function toRiskBand(risk: number): RiskBand {
  if (risk >= RISK_BAND_HIGH) return 'high'
  if (risk >= RISK_BAND_MID) return 'mid'
  return 'low'
}

/**
 * 下げ止まりの兆候があるか。
 * 安値を更新し続けている、あるいは直近5日で崩れている間は「まだ落ちている最中」とみなす。
 */
function isStabilizing(m: CandidateMetrics): boolean {
  const notMakingNewLows = m.distanceFromLow20 > NEW_LOW_TOLERANCE
  const notFreeFalling = m.return5d > DANGER_DROP_5D
  return notMakingNewLows && notFreeFalling
}

/**
 * 候補を仕分ける。主軸は「その銘柄自身の過去と比べて安いか」。
 *
 * 「今日下がった」は候補の入口条件でしかない。安値圏でない銘柄をいくら並べても
 * 割安株を探す助けにならないため、割安でなければ見送りにする。
 * 判定はスコアの閾値ではなく、利用者に言葉で説明できる条件で書く。
 */
export function classify(
  m: CandidateMetrics,
  valuation: ValuationSnapshot | null,
  downtrendRisk: number,
): CandidateCategory {
  // 当日上昇している銘柄は「本日安くなった株」ではないため候補にしない
  if (m.return1d >= 0) return 'skip'

  // 履歴が足りず割安さを判定できない銘柄は、安いと言い切れないので出さない
  if (!valuation) return 'skip'
  if (valuation.rangePercentile > CHEAP_RANGE_PERCENTILE) return 'skip'

  // 52週高値から半値以下。短期的に下げ止まって見えても、ここまで売られたのは
  // たいてい相応の理由がある。「待てば戻る」類の下げとは区別する。
  if (valuation.drawdownFrom52wHigh <= EXTREME_DRAWDOWN) return 'trap'

  // まだ落ちている最中。安くても、下げ止まりを確認してから検討する
  if (downtrendRisk >= DANGER_RISK_THRESHOLD || !isStabilizing(m)) return 'watch'

  // 安値圏で下げ止まりの兆しがあり、下落継続リスクも高くない
  return 'buy'
}

/**
 * その銘柄で実際に成立した条件だけを挙げる。
 * 全銘柄に同じ文言を並べても判断材料にならないため、該当したものだけを返す。
 */
function buildReasons(
  category: CandidateCategory,
  m: CandidateMetrics,
  valuation: ValuationSnapshot | null,
): string[] {
  const reasons: string[] = []
  if (category === 'skip' || !valuation) return reasons

  reasons.push(
    `過去2年の値動きのなかで下位${(valuation.rangePercentile * 100).toFixed(0)}%の安さ`,
  )

  if (valuation.ma200Deviation < -0.05) {
    reasons.push(
      `200日線から${formatReturn(valuation.ma200Deviation)}（過去2年で下位${(
        valuation.ma200DeviationPercentile * 100
      ).toFixed(0)}%の深さ）`,
    )
  }
  if (valuation.drawdownFrom52wHigh < -0.15) {
    reasons.push(`52週高値から${formatReturn(valuation.drawdownFrom52wHigh)}`)
  }
  if (m.rsi14 <= 30) {
    reasons.push(`RSI14は${m.rsi14.toFixed(0)}で売られすぎ圏`)
  } else if (m.rsi14 <= REBOUND_RSI_CEILING) {
    reasons.push(`RSI14は${m.rsi14.toFixed(0)}で下げ渋り`)
  }
  if (category === 'buy' && m.distanceFromLow20 > 0.02) {
    reasons.push(`20日安値から+${(m.distanceFromLow20 * 100).toFixed(1)}%まで戻している`)
  }
  if (category === 'buy' && m.sma5 > m.sma20) {
    reasons.push('5日線が20日線を上回り、短期は上向き')
  }

  return reasons
}

function buildCautions(
  category: CandidateCategory,
  m: CandidateMetrics,
  valuation: ValuationSnapshot | null,
): string[] {
  const cautions: string[] = []

  if (category === 'skip') {
    if (valuation && valuation.rangePercentile > CHEAP_RANGE_PERCENTILE) {
      cautions.push(
        `過去2年で下位${(valuation.rangePercentile * 100).toFixed(0)}%の水準。安値圏ではない`,
      )
    } else {
      cautions.push('割安と判断できる材料が乏しい')
    }
    return cautions
  }

  if (category === 'trap') {
    if (valuation && valuation.drawdownFrom52wHigh <= EXTREME_DRAWDOWN) {
      cautions.push(
        `52週高値から${formatReturn(valuation.drawdownFrom52wHigh)}。半値以下まで売られている`,
      )
    }
    cautions.push(`5日で${formatReturn(m.return5d)}、20日で${formatReturn(m.return20d)}の下落`)
    if (m.distanceFromLow20 <= 0.01) cautions.push('20日安値を更新中')
    cautions.push('安いのには理由がある可能性。決算と適時開示を必ず確認する')
    return cautions
  }

  if (category === 'watch') {
    if (m.distanceFromLow20 <= NEW_LOW_TOLERANCE) {
      cautions.push('20日安値を更新中。下げ止まりを確認してから検討する')
    } else if (m.return5d <= DANGER_DROP_5D) {
      cautions.push(`直近5日で${formatReturn(m.return5d)}。まだ落ちている最中`)
    } else {
      cautions.push('下落が続くリスクが高い。下げ止まりを確認してから検討する')
    }
  }

  if (m.distanceFromLow20 <= NEW_LOW_TOLERANCE) cautions.push('20日安値を更新中')
  if (m.volatility20 > 0.035) {
    cautions.push(`日々の値動きが${(m.volatility20 * 100).toFixed(1)}%と大きい`)
  }
  cautions.push('買う前に損切り条件を決める')

  return cautions
}

/**
 * 終値配列から候補1件を算出する。データが不足している場合は null。
 * rank は呼び出し側で並べ替え後に付与する。
 */
export function computeCandidate(source: CandidateSource): Omit<CandidateItem, 'rank'> | null {
  const { today, entry } = source
  if (!Number.isFinite(today.close) || today.close <= 0) return null

  const closes = alignCloses(source.closes, today.close)
  if (closes.length < 26) return null

  const m = buildMetrics(closes, today)
  const valuation = computeValuation(closes)
  const downtrendRisk = computeDowntrendRisk(m)
  const category = classify(m, valuation, downtrendRisk)

  return {
    code: entry.code,
    name: entry.name,
    segment: entry.segment,
    category,
    categoryLabel: CANDIDATE_CATEGORY_LABELS[category],
    close: m.close,
    return1d: m.return1d,
    return5d: m.return5d,
    return20d: m.return20d,
    volume: today.volume,
    turnover: today.volume * m.close,
    rsi14: m.rsi14,
    distanceFromLow20: m.distanceFromLow20,
    downtrendRisk,
    riskBand: toRiskBand(downtrendRisk),
    valuation,
    lot: computeLotCost(m.close, SAMPLE_BUDGET_YEN),
    targets: computePriceTargets(m.close, m.volatility20),
    reasons: buildReasons(category, m, valuation),
    cautions: buildCautions(category, m, valuation),
  }
}

const CATEGORY_ORDER: Record<CandidateCategory, number> = {
  buy: 0,
  watch: 1,
  trap: 2,
  skip: 3,
}

/** 割安なほど大きい値。同カテゴリ内の並び順に使う。 */
export function cheapnessScore(item: Omit<CandidateItem, 'rank'>): number {
  return item.valuation?.score ?? 0
}

/**
 * 候補配列を「買い候補→監視→割安だが要注意→見送り」の順、
 * 同カテゴリ内は割安度スコア順に並べ、rank を付与する。
 */
export function rankCandidates(
  items: Array<Omit<CandidateItem, 'rank'>>,
): { candidates: CandidateItem[]; counts: CandidateCounts } {
  const sorted = [...items].sort((a, b) => {
    if (CATEGORY_ORDER[a.category] !== CATEGORY_ORDER[b.category]) {
      return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
    }
    return cheapnessScore(b) - cheapnessScore(a)
  })

  const counts: CandidateCounts = { buy: 0, watch: 0, trap: 0, skip: 0 }
  const candidates = sorted.map((item, index) => {
    counts[item.category] += 1
    return { ...item, rank: index + 1 }
  })

  return { candidates, counts }
}
