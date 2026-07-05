import {
  CANDIDATE_CATEGORY_LABELS,
  SAMPLE_BUDGET_YEN,
} from '../constants'
import type {
  CandidateCategory,
  CandidateCounts,
  CandidateItem,
  RiskBand,
  WatchlistEntry,
} from '../types'
import { clamp, formatReturn } from '../utils'

export interface CandidateSource {
  entry: WatchlistEntry
  /** 古い→新しい順の日次終値 */
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

/** 標準的な RSI（0〜100）を末尾値で返す */
function computeRsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50
  let gains = 0
  let losses = 0
  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1]
    gains += Math.max(delta, 0)
    losses += Math.max(-delta, 0)
  }
  let averageGain = gains / period
  let averageLoss = losses / period
  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1]
    averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period
    averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period
  }
  if (averageLoss === 0) return 100
  const rs = averageGain / averageLoss
  return 100 - 100 / (1 + rs)
}

function volatilityOfLast(closes: number[], window: number): number {
  const returns: number[] = []
  const start = Math.max(1, closes.length - window)
  for (let index = start; index < closes.length; index += 1) {
    returns.push(closes[index] / closes[index - 1] - 1)
  }
  if (returns.length <= 1) return 0
  const avg = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance =
    returns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / returns.length
  return Math.sqrt(variance)
}

function buildMetrics(closes: number[]): CandidateMetrics {
  const close = closes[closes.length - 1]
  const window20 = closes.slice(-20)
  const high20 = Math.max(...window20)
  const low20 = Math.min(...window20)
  return {
    close,
    return1d: returnOver(closes, 1),
    return5d: returnOver(closes, 5),
    return20d: returnOver(closes, 20),
    sma5: meanOfLast(closes, 5),
    sma20: meanOfLast(closes, 20),
    sma25: meanOfLast(closes, 25),
    rsi14: computeRsi(closes),
    distanceFromHigh20: high20 === 0 ? 0 : close / high20 - 1,
    distanceFromLow20: low20 === 0 ? 0 : close / low20 - 1,
    volatility20: volatilityOfLast(closes, 20),
  }
}

function computeReboundScore(m: CandidateMetrics): number {
  return Math.round(
    clamp(
      45 +
        (50 - m.rsi14) * 0.5 +
        clamp(m.return1d * 100, -5, 5) * 2 +
        clamp(m.distanceFromLow20 * 100, 0, 10) * 1.2 -
        clamp(-m.return5d * 100, 0, 15) * 0.4,
      0,
      100,
    ),
  )
}

function computeDowntrendRisk(m: CandidateMetrics): number {
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
  if (risk >= 65) return 'high'
  if (risk >= 40) return 'mid'
  return 'low'
}

function classify(m: CandidateMetrics, reboundScore: number, downtrendRisk: number): CandidateCategory {
  const makingNewLows = m.distanceFromLow20 <= 0.005
  if (downtrendRisk >= 65 || (m.return5d <= -0.07 && makingNewLows)) {
    return 'danger'
  }
  const uptrend = m.sma5 > m.sma20 && m.return20d > -0.02
  const shortPullback = m.return1d < 0 || m.return5d < 0
  if (uptrend && shortPullback) {
    return 'dip'
  }
  if (reboundScore >= 55 && m.return20d < 0) {
    return 'rebound'
  }
  return 'skip'
}

function buildReasons(category: CandidateCategory, m: CandidateMetrics): string[] {
  const reasons: string[] = []
  if (category === 'dip') {
    reasons.push(m.close >= m.sma25 ? '25日線を上回り基調は維持' : '25日線付近で押し目を形成')
    reasons.push(`直近5日は${formatReturn(m.return5d)}の押し`)
    if (m.return20d > 0) reasons.push('20日騰落はプラス圏')
  } else if (category === 'rebound') {
    reasons.push('直近安値から反発の兆し')
    if (m.rsi14 < 40) reasons.push('RSIは売られすぎ圏から回復')
    if (m.return1d > 0) reasons.push(`本日は${formatReturn(m.return1d)}と反発`)
  }
  return reasons
}

function buildCautions(category: CandidateCategory, m: CandidateMetrics): string[] {
  const cautions: string[] = []
  if (category === 'danger') {
    cautions.push(`5日で${formatReturn(m.return5d)}の急落`)
    if (m.distanceFromLow20 <= 0.01) cautions.push('20日安値を更新中')
    cautions.push('悪材料の有無を確認')
  } else if (category === 'skip') {
    cautions.push('明確な短期エッジは乏しい')
  } else {
    cautions.push('損切り条件を先に決める')
  }
  return cautions
}

/**
 * 終値配列から候補1件を算出する。データが不足している場合は null。
 * rank は呼び出し側で並べ替え後に付与する。
 */
export function computeCandidate(source: CandidateSource): Omit<CandidateItem, 'rank'> | null {
  const closes = source.closes.filter((value) => Number.isFinite(value) && value > 0)
  if (closes.length < 6) return null

  const m = buildMetrics(closes)
  if (!Number.isFinite(m.close) || m.close <= 0) return null

  const reboundScore = computeReboundScore(m)
  const downtrendRisk = computeDowntrendRisk(m)
  const category = classify(m, reboundScore, downtrendRisk)

  return {
    code: source.entry.code,
    name: source.entry.name,
    sector: source.entry.sector,
    category,
    categoryLabel: CANDIDATE_CATEGORY_LABELS[category],
    close: m.close,
    return1d: m.return1d,
    return5d: m.return5d,
    return20d: m.return20d,
    reboundScore,
    downtrendRisk,
    riskBand: toRiskBand(downtrendRisk),
    sharesFor50k: SAMPLE_BUDGET_YEN / m.close,
    target10pct: m.close * 1.1,
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
