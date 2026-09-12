import { describe, expect, it } from 'vitest'
import {
  alignCloses,
  computeCandidate,
  computeRsi,
  rankCandidates,
  type CandidateEntry,
  type CandidateSource,
} from './candidates'
import { computeValuation } from './valuation'
import { computeTrackRecord } from './track-record'
import { computeLotCost, computePriceTargets, dailyVolatility } from './targets'
import {
  CHEAP_RANGE_PERCENTILE,
  SAMPLE_BUDGET_YEN,
  SHARES_PER_LOT,
  TARGET_HORIZON_DAYS,
} from '../constants'

const entry: CandidateEntry = { code: '7203.T', name: 'テスト自動車', segment: 'プライム' }

/** 長期の上昇トレンドの末尾で軽く押した終値配列（＝安値圏ではない） */
function uptrendWithDip(length = 500): number[] {
  const closes: number[] = []
  let value = 100
  for (let index = 0; index < length - 1; index += 1) {
    value *= 1.002
    closes.push(value)
  }
  closes.push(value * 0.985)
  return closes
}

/**
 * 高値をつけたあと大きく下げ、安値をつけてから小幅に戻している配列。
 * 末尾は「安値圏だが下げ止まっている」状態＝買い候補の形。
 */
function fallenFromHigh(length = 500): number[] {
  const closes: number[] = []
  let value = 100
  for (let index = 0; index < 250; index += 1) {
    value *= 1.004
    closes.push(value)
  }
  for (let index = 250; index < length - 20; index += 1) {
    value *= 0.997
    closes.push(value)
  }
  // 安値をつけたあと 19 日かけて数%戻す（20日安値から離れる）
  for (let index = 0; index < 19; index += 1) {
    value *= 1.003
    closes.push(value)
  }
  // 当日は小幅安
  closes.push(value * 0.99)
  return closes
}

/** 安値圏で、なお加速して下げ続けている配列 */
function stillFalling(length = 500): number[] {
  const closes: number[] = []
  let value = 100
  for (let index = 0; index < 250; index += 1) {
    value *= 1.004
    closes.push(value)
  }
  for (let index = 250; index < length - 10; index += 1) {
    value *= 0.996
    closes.push(value)
  }
  for (let index = 0; index < 10; index += 1) {
    value *= 0.975
    closes.push(value)
  }
  return closes
}

function todayFrom(closes: number[], volume = 1_000_000): CandidateSource['today'] {
  const close = closes[closes.length - 1]
  const previous = closes[closes.length - 2]
  return { close, return1d: close / previous - 1, volume }
}

function sourceOf(closes: number[]): CandidateSource {
  return { entry, today: todayFrom(closes), closes }
}

describe('alignCloses', () => {
  it('末尾をランキング由来の当日終値で置き換える', () => {
    expect(alignCloses([100, 101, 102], 105)).toEqual([100, 101, 105])
  })

  it('欠損値や非正の値を落とす', () => {
    expect(alignCloses([100, Number.NaN, 0, 102], 105)).toEqual([100, 105])
  })
})

describe('computeValuation', () => {
  it('履歴が足りなければ null', () => {
    expect(computeValuation([100, 101, 102])).toBeNull()
  })

  it('一貫した上昇トレンドの末尾は「安くない」と判定する', () => {
    const valuation = computeValuation(uptrendWithDip())
    expect(valuation).not.toBeNull()
    if (!valuation) return
    // 現在値は過去2年のほぼ最高値付近にある
    expect(valuation.rangePercentile).toBeGreaterThan(0.9)
    expect(valuation.score).toBeLessThan(30)
  })

  it('高値から大きく下げた銘柄は「安い」と判定する', () => {
    const valuation = computeValuation(fallenFromHigh())
    expect(valuation).not.toBeNull()
    if (!valuation) return
    expect(valuation.rangePercentile).toBeLessThanOrEqual(CHEAP_RANGE_PERCENTILE)
    expect(valuation.drawdownFrom52wHigh).toBeLessThan(0)
    expect(valuation.ma200Deviation).toBeLessThan(0)
    expect(valuation.score).toBeGreaterThan(50)
  })

  it('レンジ内位置は 0〜1 に収まる', () => {
    for (const closes of [uptrendWithDip(), fallenFromHigh(), stillFalling()]) {
      const valuation = computeValuation(closes)
      expect(valuation).not.toBeNull()
      if (!valuation) continue
      expect(valuation.rangePercentile).toBeGreaterThanOrEqual(0)
      expect(valuation.rangePercentile).toBeLessThanOrEqual(1)
      expect(valuation.score).toBeGreaterThanOrEqual(0)
      expect(valuation.score).toBeLessThanOrEqual(100)
    }
  })
})

describe('computeTrackRecord', () => {
  it('履歴が足りなければ null', () => {
    expect(computeTrackRecord([100, 101, 102])).toBeNull()
  })

  it('先読みをしない: 未来のデータを足しても過去日の判定が変わらない', () => {
    const base = fallenFromHigh(500)
    // 後半に大きな上昇を足しても、それ以前の日の「安値圏だったか」は変わってはいけない
    const extended = [...base]
    let value = base[base.length - 1]
    for (let index = 0; index < 60; index += 1) {
      value *= 1.01
      extended.push(value)
    }

    const shortRun = computeTrackRecord(base)
    const longRun = computeTrackRecord(extended)
    expect(shortRun).not.toBeNull()
    expect(longRun).not.toBeNull()
    if (!shortRun || !longRun) return

    // 期間が伸びた分だけ標本は増えるが、減ることはない（過去の判定が覆っていない証拠）
    expect(longRun.samples).toBeGreaterThanOrEqual(shortRun.samples)
  })

  it('ベースラインと上乗せ（edge）を返す', () => {
    const record = computeTrackRecord(fallenFromHigh())
    expect(record).not.toBeNull()
    if (!record) return
    expect(record.samples).toBeGreaterThanOrEqual(5)
    expect(record.horizonDays).toBe(TARGET_HORIZON_DAYS)
    expect(record.edge).toBeCloseTo(record.averageReturn - record.baselineReturn, 10)
    expect(record.winRate).toBeGreaterThanOrEqual(0)
    expect(record.winRate).toBeLessThanOrEqual(1)
    // 保有中の最大下落は 0 以下（プラスにはならない）
    expect(record.averageDrawdown).toBeLessThanOrEqual(0)
  })
})

describe('computeCandidate', () => {
  it('データ不足では null を返す', () => {
    expect(
      computeCandidate({
        entry,
        today: { close: 101, return1d: 0.01, volume: 1000 },
        closes: [100, 101],
      }),
    ).toBeNull()
  })

  it('当日騰落率はランキング由来の値をそのまま使う', () => {
    const closes = fallenFromHigh()
    const result = computeCandidate({
      entry,
      today: { close: closes[closes.length - 1], return1d: -0.0321, volume: 500_000 },
      closes,
    })
    expect(result?.return1d).toBeCloseTo(-0.0321, 6)
  })

  it('当日が上昇している銘柄は候補にしない', () => {
    const closes = fallenFromHigh()
    const result = computeCandidate({
      entry,
      today: { close: closes[closes.length - 1], return1d: 0.02, volume: 500_000 },
      closes,
    })
    expect(result?.category).toBe('skip')
  })

  it('安値圏でなければ、当日下落していても見送りにする', () => {
    // 高値圏で今日たまたま下げただけの銘柄を「割安」と呼ばないことの確認
    const result = computeCandidate(sourceOf(uptrendWithDip()))
    expect(result?.category).toBe('skip')
    expect(result?.cautions.some((text) => text.includes('安値圏ではない'))).toBe(true)
  })

  it('安値圏で下げ止まっていれば買い候補にする', () => {
    const result = computeCandidate(sourceOf(fallenFromHigh()))
    expect(result?.category).toBe('buy')
    expect(result?.valuation).not.toBeNull()
    expect(result?.reasons.some((text) => text.includes('下位'))).toBe(true)
  })

  it('安値圏でも下落継続リスクが高ければ「割安だが要注意」にする', () => {
    const result = computeCandidate(sourceOf(stillFalling()))
    expect(result?.category).toBe('trap')
    expect(result?.riskBand).toBe('high')
    expect(result?.cautions.some((text) => text.includes('安いのには理由がある'))).toBe(true)
  })

  it('1単元の必要資金を100株単位で算出する', () => {
    const result = computeCandidate(sourceOf(fallenFromHigh()))
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.lot.sharesPerLot).toBe(SHARES_PER_LOT)
    expect(result.lot.costPerLot).toBeCloseTo(result.close * SHARES_PER_LOT, 5)
    expect(result.lot.affordable).toBe(result.close * SHARES_PER_LOT <= SAMPLE_BUDGET_YEN)
  })

  it('目標・損切りは想定保有期間（20営業日）のボラティリティ基準', () => {
    const result = computeCandidate(sourceOf(fallenFromHigh()))
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.targets.targetPrice).toBeGreaterThan(result.close)
    expect(result.targets.stopPrice).toBeLessThan(result.close)
    expect(result.targets.targetUpside / -result.targets.stopDownside).toBeCloseTo(1.5, 5)
  })

  it('売買代金は出来高×終値', () => {
    const closes = fallenFromHigh()
    const result = computeCandidate({ entry, today: todayFrom(closes, 250_000), closes })
    expect(result?.turnover).toBeCloseTo((result?.close ?? 0) * 250_000, 3)
  })

  it('理由・注意は銘柄ごとに異なる', () => {
    const buy = computeCandidate(sourceOf(fallenFromHigh()))
    const trap = computeCandidate(sourceOf(stillFalling()))
    expect(buy?.reasons).not.toEqual(trap?.reasons)
    expect(buy?.cautions).not.toEqual(trap?.cautions)
  })
})

describe('computeRsi', () => {
  it('末尾だけを見る窓でも全期間計算と大きく変わらない', () => {
    const closes = fallenFromHigh()
    const windowed = computeRsi(closes, 14, 60)
    const full = computeRsi(closes, 14, closes.length)
    expect(Math.abs(windowed - full)).toBeLessThan(3)
  })

  it('一貫して上げ続ければ100に近づく', () => {
    const closes = Array.from({ length: 80 }, (_, index) => 100 * 1.01 ** index)
    expect(computeRsi(closes)).toBe(100)
  })
})

describe('targets', () => {
  it('ボラティリティ0なら目標も損切りも現値と同じ', () => {
    const targets = computePriceTargets(1000, 0)
    expect(targets.targetPrice).toBe(1000)
    expect(targets.stopPrice).toBe(1000)
  })

  it('1単元の必要資金は予算判定に使える', () => {
    expect(computeLotCost(1720, 500_000)).toEqual({
      sharesPerLot: 100,
      costPerLot: 172_000,
      affordable: true,
    })
    expect(computeLotCost(9_000, 500_000).affordable).toBe(false)
  })

  it('日次ボラティリティは終値配列から算出できる', () => {
    expect(dailyVolatility([100, 100, 100, 100, 100])).toBe(0)
    expect(dailyVolatility(Array.from({ length: 40 }, (_, i) => 100 * 0.99 ** i))).toBeCloseTo(0, 6)
  })

  it('保有期間が伸びれば想定変動幅も広がる', () => {
    const targets = computePriceTargets(1000, 0.02)
    // σ = 0.02 × √20 ≒ 8.9%、目標は +1.5σ ≒ +13.4%
    expect(targets.horizonSigma).toBeCloseTo(0.02 * Math.sqrt(TARGET_HORIZON_DAYS), 10)
    expect(targets.targetUpside).toBeGreaterThan(0.1)
  })
})

describe('rankCandidates', () => {
  it('カテゴリ順（買い→監視→要注意→見送り）で rank を付与し counts を集計する', () => {
    const buy = computeCandidate(sourceOf(fallenFromHigh()))
    const trapCloses = stillFalling()
    const trap = computeCandidate({
      entry: { ...entry, code: '5803.T' },
      today: todayFrom(trapCloses),
      closes: trapCloses,
    })
    expect(buy).not.toBeNull()
    expect(trap).not.toBeNull()
    if (!buy || !trap) return

    const { candidates, counts } = rankCandidates([trap, buy])
    expect(candidates[0].category).toBe('buy')
    expect(candidates[0].rank).toBe(1)
    expect(candidates[1].category).toBe('trap')
    expect(counts.buy).toBe(1)
    expect(counts.trap).toBe(1)
  })

  it('同カテゴリ内は割安な順に並ぶ', () => {
    const a = computeCandidate(sourceOf(fallenFromHigh()))
    const b = computeCandidate(sourceOf(fallenFromHigh(480)))
    if (!a || !b) return
    const { candidates } = rankCandidates([a, { ...b, code: '9999.T' }])
    const scores = candidates.map((item) => item.valuation?.score ?? 0)
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1])
  })
})
