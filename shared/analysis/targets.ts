import {
  SHARES_PER_LOT,
  STOP_SIGMA_MULTIPLIER,
  TARGET_HORIZON_DAYS,
  TARGET_SIGMA_MULTIPLIER,
} from '../constants'
import type { LotCost, PriceTargets } from '../types'

/**
 * 日次リターンの標準偏差（ボラティリティ）を直近 window 日から求める。
 * 終値配列は古い→新しい順。
 */
export function dailyVolatility(closes: number[], window = 20): number {
  const returns: number[] = []
  const start = Math.max(1, closes.length - window)
  for (let index = start; index < closes.length; index += 1) {
    const previous = closes[index - 1]
    if (!previous) continue
    returns.push(closes[index] / previous - 1)
  }
  if (returns.length <= 1) return 0

  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance =
    returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / returns.length
  return Math.sqrt(variance)
}

/**
 * 目標株価と損切り水準を、その銘柄自身のボラティリティから算出する。
 *
 * 「どの銘柄でも +10%」のような固定値は、値動きの小さい大型株では届かず、
 * 値動きの荒い小型株では過小になるため使わない。
 * 5営業日の想定変動幅 σ = 日次ボラティリティ × √5 を基準に、
 * 目標 = +1.5σ、損切り = -1.0σ とする（リスクリワード 1.5 : 1）。
 */
export function computePriceTargets(close: number, volatility: number): PriceTargets {
  const horizonSigma = volatility * Math.sqrt(TARGET_HORIZON_DAYS)
  const targetUpside = horizonSigma * TARGET_SIGMA_MULTIPLIER
  const stopDownside = -horizonSigma * STOP_SIGMA_MULTIPLIER

  return {
    horizonSigma,
    targetPrice: close * (1 + targetUpside),
    stopPrice: close * (1 + stopDownside),
    targetUpside,
    stopDownside,
  }
}

/**
 * 1単元（日本株は原則100株）を買うのに必要な金額を求める。
 *
 * 「5万円で何株買えるか」という割り算は、端株が買えない前提では意味を持たない
 * （例: 終値1,720円なら 29.06株 と出るが、実際には100株=17.2万円が必要）。
 */
export function computeLotCost(close: number, budgetYen: number): LotCost {
  const costPerLot = close * SHARES_PER_LOT
  return {
    sharesPerLot: SHARES_PER_LOT,
    costPerLot,
    affordable: costPerLot <= budgetYen,
  }
}
