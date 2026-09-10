import {
  CANDIDATE_CATEGORY_LABELS,
  DANGER_DROP_5D,
  DANGER_RISK_THRESHOLD,
  HISTORICAL_LOOKFORWARD_DAYS,
  HISTORICAL_MIN_SAMPLES,
  NEW_LOW_TOLERANCE,
  REBOUND_RSI_CEILING,
  RISK_BAND_HIGH,
  RISK_BAND_MID,
  SAMPLE_BUDGET_YEN,
  UPTREND_DRAWDOWN_LIMIT,
} from '../constants'
import type {
  CandidateCategory,
  CandidateCounts,
  CandidateItem,
  HistoricalEdge,
  MarketSegment,
  RiskBand,
} from '../types'
import { clamp, formatReturn } from '../utils'
import { computeLotCost, computePriceTargets, dailyVolatility } from './targets'

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
  /** spark 由来の日次終値（古い→新しい順） */
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
 * Wilder 方式の RSI を各日について 1 パスで求める。
 * 戻り値は closes と同じ長さで、ウォームアップ前は 50（中立）。
 *
 * 過去の同条件を探すときに毎日 RSI を再計算すると O(n^2) になり、
 * Cloudflare Workers の CPU 時間（無料プランで 10ms）に収まらないため、
 * 逐次更新して系列として持つ。
 */
export function rsiSeries(closes: number[], period = 14): number[] {
  const values = new Array<number>(closes.length).fill(50)
  if (closes.length <= period) return values

  let gains = 0
  let losses = 0
  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1]
    gains += Math.max(delta, 0)
    losses += Math.max(-delta, 0)
  }
  let averageGain = gains / period
  let averageLoss = losses / period
  values[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)

  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1]
    averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period
    averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period
    values[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)
  }

  return values
}

/** Wilder 方式の RSI（0〜100）を末尾値で返す */
function computeRsi(closes: number[], period = 14): number {
  return rsiSeries(closes, period)[closes.length - 1]
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

/**
 * 反発期待スコア（0〜100）。
 *
 * 候補はすべて「当日値下がりした銘柄」なので、当日の下げ自体を大きく減点すると
 * 反発候補が一件も出なくなる。売られすぎ（RSI）と、20日安値から離れて
 * 下げ止まっていることを主な加点材料にし、下げ続けている度合いを減点する。
 */
export function computeReboundScore(m: CandidateMetrics): number {
  return Math.round(
    clamp(
      45 +
        // 売られすぎほど反発余地がある（RSI30 で +12、RSI20 で +18）
        (50 - m.rsi14) * 0.6 +
        // 20日安値から離れているほど下げ止まりの形（最大 +10）
        clamp(m.distanceFromLow20 * 100, 0, 10) * 1.0 -
        // 直近5日で下げ続けているほど反発は遠い（最大 -7.5）
        clamp(-m.return5d * 100, 0, 15) * 0.5 -
        // 当日の下げが急なほど、まだ落ちている最中の可能性（最大 -5）
        clamp(-m.return1d * 100, 0, 5) * 1.0,
      0,
      100,
    ),
  )
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
 * 候補を「押し目 / 反発 / 危険 / 見送り」に仕分ける。
 *
 * 画面では「本日値下がりした銘柄を集める」と説明しているため、
 * 押し目・反発はいずれも当日下落を必須条件にする。
 *
 * 分類はスコアの閾値ではなく、利用者に言葉で説明できる条件で行う。
 * reboundScore はカテゴリ内の並び順にだけ使う。
 */
export function classify(m: CandidateMetrics, downtrendRisk: number): CandidateCategory {
  const makingNewLows = m.distanceFromLow20 <= NEW_LOW_TOLERANCE
  if (downtrendRisk >= DANGER_RISK_THRESHOLD || (m.return5d <= DANGER_DROP_5D && makingNewLows)) {
    return 'danger'
  }

  // 当日上昇している銘柄は「本日安くなった株」ではないため候補にしない
  if (m.return1d >= 0) return 'skip'

  // 上昇基調が続いているなかでの一時的な下げ = 押し目
  if (m.sma5 > m.sma20 && m.return20d > UPTREND_DRAWDOWN_LIMIT) return 'dip'

  // 調整局面で売られすぎ圏にあり、危険ほどは崩れていない = 反発
  if (m.return20d < 0 && m.rsi14 <= REBOUND_RSI_CEILING) return 'rebound'

  return 'skip'
}

/**
 * 同じ銘柄の過去データで同じ条件が成立した日を探し、その後
 * HISTORICAL_LOOKFORWARD_DAYS 営業日の値動きを集計する。
 *
 * 外部データの追加取得は不要（spark で取得済みの履歴だけで完結する）。
 * 判定は現在の分類と同じ骨格を使うが、1日あたり O(1) で回せるよう
 * 移動平均を逐次計算した簡易版にしている。
 */
export function computeHistoricalEdge(
  closes: number[],
  category: CandidateCategory,
): HistoricalEdge | null {
  if (category === 'skip' || closes.length < 30 + HISTORICAL_LOOKFORWARD_DAYS) return null

  const forwardReturns: number[] = []
  const lastEvaluable = closes.length - 1 - HISTORICAL_LOOKFORWARD_DAYS
  const rsi = rsiSeries(closes)

  for (let index = 25; index <= lastEvaluable; index += 1) {
    const close = closes[index]
    const previous = closes[index - 1]
    if (!close || !previous) continue

    const return1d = close / previous - 1
    const return5d = closes[index - 5] ? close / closes[index - 5] - 1 : 0
    const return20d = closes[index - 20] ? close / closes[index - 20] - 1 : 0

    let sum5 = 0
    for (let offset = 0; offset < 5; offset += 1) sum5 += closes[index - offset]
    let sum20 = 0
    for (let offset = 0; offset < 20; offset += 1) sum20 += closes[index - offset]
    const sma5 = sum5 / 5
    const sma20 = sum20 / 20

    // 現在の分類ルール（classify）と同じ条件で過去の該当日を探す
    let matches = false
    if (category === 'dip') {
      matches = return1d < 0 && sma5 > sma20 && return20d > UPTREND_DRAWDOWN_LIMIT
    } else if (category === 'rebound') {
      matches =
        return1d < 0 &&
        return20d < 0 &&
        !(sma5 > sma20 && return20d > UPTREND_DRAWDOWN_LIMIT) &&
        rsi[index] <= REBOUND_RSI_CEILING
    } else if (category === 'danger') {
      matches = return5d <= DANGER_DROP_5D
    }
    if (!matches) continue

    const future = closes[index + HISTORICAL_LOOKFORWARD_DAYS]
    if (!future) continue
    forwardReturns.push(future / close - 1)
  }

  if (forwardReturns.length < HISTORICAL_MIN_SAMPLES) return null

  const wins = forwardReturns.filter((value) => value > 0).length
  const total = forwardReturns.reduce((sum, value) => sum + value, 0)

  return {
    samples: forwardReturns.length,
    winRate: wins / forwardReturns.length,
    averageReturn: total / forwardReturns.length,
    horizonDays: HISTORICAL_LOOKFORWARD_DAYS,
  }
}

/**
 * その銘柄で実際に成立した条件だけを挙げる。
 * 全銘柄に同じ文言を並べても判断材料にならないため、該当したものだけを返す。
 */
function buildReasons(category: CandidateCategory, m: CandidateMetrics): string[] {
  const reasons: string[] = []

  if (category === 'dip') {
    reasons.push(
      m.close >= m.sma25
        ? `25日線(${Math.round(m.sma25).toLocaleString('ja-JP')}円)を上回ったまま${formatReturn(m.return1d)}`
        : `25日線付近まで${formatReturn(m.return1d)}の押し`,
    )
    if (m.return20d > 0) reasons.push(`20日騰落は${formatReturn(m.return20d)}とプラス圏`)
    if (m.return5d < 0) reasons.push(`直近5日で${formatReturn(m.return5d)}の調整`)
    if (m.rsi14 < 45) reasons.push(`RSI14は${m.rsi14.toFixed(0)}で過熱感はない`)
    if (m.distanceFromHigh20 > -0.03) reasons.push('20日高値圏を維持')
  } else if (category === 'rebound') {
    if (m.rsi14 < 35) reasons.push(`RSI14は${m.rsi14.toFixed(0)}で売られすぎ圏`)
    else if (m.rsi14 < 45) reasons.push(`RSI14は${m.rsi14.toFixed(0)}で下げ渋り`)
    if (m.distanceFromLow20 > NEW_LOW_TOLERANCE) {
      reasons.push(`20日安値から+${(m.distanceFromLow20 * 100).toFixed(1)}%の位置`)
    }
    if (m.return20d < 0) reasons.push(`20日騰落は${formatReturn(m.return20d)}で調整局面`)
  }

  return reasons
}

function buildCautions(category: CandidateCategory, m: CandidateMetrics): string[] {
  const cautions: string[] = []

  if (category === 'danger') {
    cautions.push(`5日で${formatReturn(m.return5d)}の下落`)
    if (m.distanceFromLow20 <= 0.01) cautions.push('20日安値を更新中')
    if (m.volatility20 > 0.04) {
      cautions.push(`日々の値動きが${(m.volatility20 * 100).toFixed(1)}%と荒い`)
    }
    cautions.push('決算・適時開示など悪材料の有無を確認')
    return cautions
  }

  if (category === 'skip') {
    cautions.push('明確な短期エッジは乏しい')
    return cautions
  }

  if (m.volatility20 > 0.035) {
    cautions.push(`日々の値動きが${(m.volatility20 * 100).toFixed(1)}%と大きい`)
  }
  if (m.rsi14 > 60) cautions.push(`RSI14は${m.rsi14.toFixed(0)}でまだ高め`)
  cautions.push('損切り条件を先に決める')

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
  const reboundScore = computeReboundScore(m)
  const downtrendRisk = computeDowntrendRisk(m)
  const category = classify(m, downtrendRisk)

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
    reboundScore,
    downtrendRisk,
    riskBand: toRiskBand(downtrendRisk),
    lot: computeLotCost(m.close, SAMPLE_BUDGET_YEN),
    targets: computePriceTargets(m.close, m.volatility20),
    historicalEdge: computeHistoricalEdge(closes, category),
    reasons: buildReasons(category, m),
    cautions: buildCautions(category, m),
  }
}

const CATEGORY_ORDER: Record<CandidateCategory, number> = {
  dip: 0,
  rebound: 1,
  danger: 2,
  skip: 3,
}

/**
 * 候補配列を「押し目→反発→危険→見送り」の順、同カテゴリ内はスコア順に並べ、
 * rank を付与して返す。counts も併せて集計する。
 */
export function rankCandidates(
  items: Array<Omit<CandidateItem, 'rank'>>,
): { candidates: CandidateItem[]; counts: CandidateCounts } {
  const sorted = [...items].sort((a, b) => {
    if (CATEGORY_ORDER[a.category] !== CATEGORY_ORDER[b.category]) {
      return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
    }
    // 危険は下落継続リスク降順、それ以外は反発期待スコア降順
    if (a.category === 'danger') return b.downtrendRisk - a.downtrendRisk
    return b.reboundScore - a.reboundScore
  })

  const counts: CandidateCounts = { dip: 0, rebound: 0, danger: 0, skip: 0 }
  const candidates = sorted.map((item, index) => {
    counts[item.category] += 1
    return { ...item, rank: index + 1 }
  })

  return { candidates, counts }
}
