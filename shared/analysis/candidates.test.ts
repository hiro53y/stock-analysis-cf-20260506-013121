import { describe, expect, it } from 'vitest'
import {
  alignCloses,
  computeCandidate,
  computeHistoricalEdge,
  rankCandidates,
  type CandidateEntry,
  type CandidateSource,
} from './candidates'
import { computeLotCost, computePriceTargets, dailyVolatility } from './targets'
import { SAMPLE_BUDGET_YEN, SHARES_PER_LOT } from '../constants'

const entry: CandidateEntry = { code: '7203.T', name: 'テスト自動車', segment: 'プライム' }

/** 上昇トレンドの末尾で軽く押した終値配列 */
function uptrendWithDip(): number[] {
  const closes: number[] = []
  let value = 100
  for (let index = 0; index < 40; index += 1) {
    value *= 1.006
    closes.push(value)
  }
  closes.push(value * 0.985)
  return closes
}

/** 継続的に大きく下落し、末尾で安値を更新する終値配列 */
function sharpDowntrend(): number[] {
  const closes: number[] = []
  let value = 200
  for (let index = 0; index < 40; index += 1) {
    value *= 0.985
    closes.push(value)
  }
  return closes
}

/** 終値配列の末尾から当日の実績値（ランキング相当）を作る */
function todayFrom(closes: number[], volume = 1_000_000): CandidateSource['today'] {
  const close = closes[closes.length - 1]
  const previous = closes[closes.length - 2]
  return { close, return1d: close / previous - 1, volume }
}

function sourceOf(closes: number[], overrides: Partial<CandidateSource> = {}): CandidateSource {
  return { entry, today: todayFrom(closes), closes, ...overrides }
}

describe('alignCloses', () => {
  it('末尾をランキング由来の当日終値で置き換える', () => {
    expect(alignCloses([100, 101, 102], 105)).toEqual([100, 101, 105])
  })

  it('欠損値や非正の値を落とす', () => {
    expect(alignCloses([100, Number.NaN, 0, 102], 105)).toEqual([100, 105])
  })
})

describe('computeCandidate', () => {
  it('データ不足では null を返す', () => {
    expect(
      computeCandidate({ entry, today: { close: 101, return1d: 0.01, volume: 1000 }, closes: [100, 101] }),
    ).toBeNull()
  })

  it('当日騰落率はランキング由来の値をそのまま使う', () => {
    const closes = uptrendWithDip()
    const result = computeCandidate({
      entry,
      today: { close: closes[closes.length - 1], return1d: -0.0321, volume: 500_000 },
      closes,
    })
    expect(result?.return1d).toBeCloseTo(-0.0321, 6)
  })

  it('1単元の必要資金を100株単位で算出する', () => {
    const result = computeCandidate(sourceOf(uptrendWithDip()))
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.lot.sharesPerLot).toBe(SHARES_PER_LOT)
    expect(result.lot.costPerLot).toBeCloseTo(result.close * SHARES_PER_LOT, 5)
    expect(result.lot.affordable).toBe(result.close * SHARES_PER_LOT <= SAMPLE_BUDGET_YEN)
  })

  it('目標株価と損切り水準はボラティリティ基準で、固定の±10%ではない', () => {
    const result = computeCandidate(sourceOf(uptrendWithDip()))
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.targets.targetPrice).toBeGreaterThan(result.close)
    expect(result.targets.stopPrice).toBeLessThan(result.close)
    expect(result.targets.targetUpside).not.toBeCloseTo(0.1, 3)
    // リスクリワードは 1.5 : 1
    expect(result.targets.targetUpside / -result.targets.stopDownside).toBeCloseTo(1.5, 5)
  })

  it('売買代金は出来高×終値', () => {
    const closes = uptrendWithDip()
    const result = computeCandidate({ entry, today: todayFrom(closes, 250_000), closes })
    expect(result?.turnover).toBeCloseTo((result?.close ?? 0) * 250_000, 3)
  })

  it('上昇基調で当日下落なら押し目候補に分類する', () => {
    const result = computeCandidate(sourceOf(uptrendWithDip()))
    expect(result?.category).toBe('dip')
    expect(result?.reasons.length).toBeGreaterThan(0)
  })

  it('当日が上昇している銘柄は候補にしない（画面の説明と実装を一致させる）', () => {
    const closes = uptrendWithDip()
    const result = computeCandidate({
      entry,
      today: { close: closes[closes.length - 1], return1d: 0.0496, volume: 500_000 },
      closes,
    })
    expect(result?.category).toBe('skip')
  })

  it('調整局面で売られすぎ圏なら反発候補に分類する', () => {
    // 20日騰落はマイナス、直近は下げ渋って RSI が低い系列
    const closes: number[] = []
    let value = 200
    for (let index = 0; index < 30; index += 1) {
      value *= 0.993
      closes.push(value)
    }
    for (let index = 0; index < 8; index += 1) {
      value *= index % 2 === 0 ? 0.999 : 1.001
      closes.push(value)
    }
    closes.push(value * 0.995)

    const result = computeCandidate(sourceOf(closes))
    expect(result?.category).toBe('rebound')
    expect(result?.reasons.some((text) => text.includes('RSI'))).toBe(true)
  })

  it('急落局面は危険な下落に分類しリスク区分が高い', () => {
    const result = computeCandidate(sourceOf(sharpDowntrend()))
    expect(result?.category).toBe('danger')
    expect(result?.riskBand).toBe('high')
    expect(result?.cautions.length).toBeGreaterThan(0)
  })

  it('危険な下落は当日プラスでも危険のまま（下落継続リスクを優先する）', () => {
    const closes = sharpDowntrend()
    const result = computeCandidate({
      entry,
      today: { close: closes[closes.length - 1], return1d: 0.02, volume: 500_000 },
      closes,
    })
    expect(result?.category).toBe('danger')
  })

  it('理由・注意はその銘柄で成立した条件だけを挙げる', () => {
    const dip = computeCandidate(sourceOf(uptrendWithDip()))
    const danger = computeCandidate(sourceOf(sharpDowntrend()))
    // 旧実装では全 dip 銘柄に同じ3行が並んでいた。銘柄ごとに内容が変わることを確認する
    expect(dip?.reasons).not.toEqual(danger?.reasons)
    expect(danger?.cautions.some((text) => text.includes('20日安値'))).toBe(true)
  })
})

describe('computeHistoricalEdge', () => {
  it('標本が足りなければ null', () => {
    expect(computeHistoricalEdge([100, 101, 102], 'dip')).toBeNull()
  })

  it('見送りは集計しない', () => {
    expect(computeHistoricalEdge(uptrendWithDip(), 'skip')).toBeNull()
  })

  it('一貫した上昇トレンドでは押し目の勝率が高く出る', () => {
    // 上昇のなかで定期的に押す系列を作る
    const closes: number[] = []
    let value = 100
    for (let index = 0; index < 120; index += 1) {
      value *= index % 5 === 4 ? 0.99 : 1.008
      closes.push(value)
    }
    const edge = computeHistoricalEdge(closes, 'dip')
    expect(edge).not.toBeNull()
    if (!edge) return
    expect(edge.samples).toBeGreaterThanOrEqual(5)
    expect(edge.winRate).toBeGreaterThan(0.5)
    expect(edge.horizonDays).toBe(5)
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
    expect(dailyVolatility(sharpDowntrend())).toBeCloseTo(0, 6)
  })
})

describe('rankCandidates', () => {
  it('カテゴリ順（押し目→反発→危険→見送り）で rank を付与し counts を集計する', () => {
    const dip = computeCandidate(sourceOf(uptrendWithDip()))
    const dangerCloses = sharpDowntrend()
    const danger = computeCandidate({
      entry: { ...entry, code: '5803.T' },
      today: todayFrom(dangerCloses),
      closes: dangerCloses,
    })
    expect(dip).not.toBeNull()
    expect(danger).not.toBeNull()
    if (!dip || !danger) return

    const { candidates, counts } = rankCandidates([danger, dip])
    expect(candidates[0].category).toBe('dip')
    expect(candidates[0].rank).toBe(1)
    expect(candidates[1].category).toBe('danger')
    expect(counts.dip).toBe(1)
    expect(counts.danger).toBe(1)
  })
})
