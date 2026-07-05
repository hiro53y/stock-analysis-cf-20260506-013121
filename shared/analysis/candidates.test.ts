import { describe, expect, it } from 'vitest'
import { computeCandidate, rankCandidates } from './candidates'
import type { WatchlistEntry } from '../types'

const entry: WatchlistEntry = { code: '7203.T', name: 'テスト自動車', sector: '自動車' }

/** 上昇トレンドの末尾で軽く押した終値配列 */
function uptrendWithDip(): number[] {
  const closes: number[] = []
  let value = 100
  for (let index = 0; index < 40; index += 1) {
    value *= 1.006
    closes.push(value)
  }
  // 直近を軽く押す
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

describe('computeCandidate', () => {
  it('データ不足では null を返す', () => {
    expect(computeCandidate({ entry, closes: [100, 101] })).toBeNull()
  })

  it('派生指標（株数・目標株価）を算出する', () => {
    const result = computeCandidate({ entry, closes: uptrendWithDip() })
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.close).toBeGreaterThan(0)
    expect(result.target10pct).toBeCloseTo(result.close * 1.1, 5)
    expect(result.sharesFor50k).toBeCloseTo(50000 / result.close, 5)
    expect(result.reboundScore).toBeGreaterThanOrEqual(0)
    expect(result.reboundScore).toBeLessThanOrEqual(100)
    expect(result.downtrendRisk).toBeGreaterThanOrEqual(0)
    expect(result.downtrendRisk).toBeLessThanOrEqual(100)
  })

  it('上昇基調の押しは押し目候補に分類する', () => {
    const result = computeCandidate({ entry, closes: uptrendWithDip() })
    expect(result?.category).toBe('dip')
    expect(result?.reasons.length).toBeGreaterThan(0)
  })

  it('急落局面は危険な下落に分類しリスク区分が高い', () => {
    const result = computeCandidate({ entry, closes: sharpDowntrend() })
    expect(result?.category).toBe('danger')
    expect(result?.riskBand).toBe('high')
    expect(result?.cautions.length).toBeGreaterThan(0)
  })
})

describe('rankCandidates', () => {
  it('カテゴリ順（押し目→反発→危険→見送り）で rank を付与し counts を集計する', () => {
    const dip = computeCandidate({ entry, closes: uptrendWithDip() })
    const danger = computeCandidate({ entry: { ...entry, code: '5803.T' }, closes: sharpDowntrend() })
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
