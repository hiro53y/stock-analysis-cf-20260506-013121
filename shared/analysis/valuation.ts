import {
  DRAWDOWN_FULL_CHEAP,
  MA_LONG_PERIOD,
  VALUATION_MIN_DAYS,
  VALUATION_SAMPLE_STEP,
  WEEKS52_DAYS,
} from '../constants'
import type { ValuationSnapshot } from '../types'
import { clamp } from '../utils'

/**
 * 「その銘柄自身の過去と比べて安いか」を測る。
 *
 * 業種平均や絶対基準（PER15倍以下など）ではなく自己相対で見るのは、
 * 業種によって適正な水準が違ううえ、日本株の業種別集計を無認証で取得できないため。
 * ここで使うのは終値だけなので、候補一覧の全銘柄について追加の外部取得なしに計算できる。
 *
 * 計算量に注意: 候補は60銘柄あり、1銘柄あたり2年分（約480本）の終値を持つ。
 * Cloudflare Workers の CPU 時間（無料プランで1リクエスト10ms）に収めるため、
 * 分布を数えるループは VALUATION_SAMPLE_STEP 本ごとに間引く。
 * 実測では全件計算との差はパーセンタイルで1ポイント未満（例: 75.4% → 75.5%）。
 */

/** 間引きながら「value より安かった日」の割合を数える。0=最安値、1=最高値。 */
function percentileOf(values: number[], value: number, step: number): number {
  let below = 0
  let total = 0
  for (let index = 0; index < values.length; index += step) {
    if (values[index] < value) below += 1
    total += 1
  }
  return total === 0 ? 0.5 : below / total
}

/**
 * 現在値の「長期線からの乖離」と、その乖離が過去のなかでどれくらい珍しいかを返す。
 *
 * 単に「200日線から-15%」と言われても深いのか浅いのかは銘柄によって違う。
 * 「その乖離は過去2年で下位6%の深さ」と添えて初めて判断材料になる。
 */
function longTermDeviation(
  closes: number[],
  period: number,
  step: number,
): { deviation: number; percentile: number } | null {
  const n = closes.length
  if (n < period + 1) return null

  let tail = 0
  for (let index = n - period; index < n; index += 1) tail += closes[index]
  const currentMa = tail / period
  if (currentMa <= 0) return null
  const deviation = closes[n - 1] / currentMa - 1

  // 過去の各日についても同じ乖離を求め、現在の乖離が下から何割かを数える。
  // 移動平均は逐次更新（O(n)）、分布のカウントは間引く。
  let running = 0
  for (let index = 0; index < period; index += 1) running += closes[index]

  let below = 0
  let total = 0
  for (let index = period; index < n; index += 1) {
    if ((index - period) % step === 0) {
      const movingAverage = running / period
      if (movingAverage > 0) {
        if (closes[index] / movingAverage - 1 < deviation) below += 1
        total += 1
      }
    }
    running += closes[index] - closes[index - period]
  }

  return { deviation, percentile: total === 0 ? 0.5 : below / total }
}

function highestOfLast(values: number[], window: number): number {
  let highest = 0
  for (let index = Math.max(0, values.length - window); index < values.length; index += 1) {
    if (values[index] > highest) highest = values[index]
  }
  return highest
}

/**
 * 割安度スコア（0〜100、大きいほど割安）。
 *
 * 合成値だけでは「なぜ割安と言えるのか」が伝わらないため、
 * 画面では必ず内訳3つ（レンジ内位置・長期線乖離・52週高値からの下落）を併記する。
 */
function composeScore(
  rangePercentile: number,
  deviationPercentile: number,
  drawdown: number,
): number {
  const cheapByRange = (1 - rangePercentile) * 100
  const cheapByDeviation = (1 - deviationPercentile) * 100
  const cheapByDrawdown = clamp(-drawdown / DRAWDOWN_FULL_CHEAP, 0, 1) * 100

  // レンジ内位置を主軸に置く。「その銘柄自身の過去と比べて安い」を最も直接表すため。
  return Math.round(cheapByRange * 0.5 + cheapByDeviation * 0.25 + cheapByDrawdown * 0.25)
}

export function computeValuation(closes: number[]): ValuationSnapshot | null {
  const n = closes.length
  if (n < VALUATION_MIN_DAYS) return null

  const close = closes[n - 1]
  if (!Number.isFinite(close) || close <= 0) return null

  const step = VALUATION_SAMPLE_STEP
  const rangePercentile = percentileOf(closes, close, step)
  const longTerm = longTermDeviation(closes, MA_LONG_PERIOD, step)

  const high52 = highestOfLast(closes, WEEKS52_DAYS)
  const drawdownFrom52wHigh = high52 > 0 ? close / high52 - 1 : 0

  const deviation = longTerm?.deviation ?? 0
  const deviationPercentile = longTerm?.percentile ?? 0.5

  return {
    rangePercentile,
    ma200Deviation: deviation,
    ma200DeviationPercentile: deviationPercentile,
    drawdownFrom52wHigh,
    score: composeScore(rangePercentile, deviationPercentile, drawdownFrom52wHigh),
    sampleDays: n,
  }
}
