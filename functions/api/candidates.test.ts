import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet } from './candidates'
import { buildShortlist, resolveRegistered, todayFromHistory } from './candidates'
import { parseRankingRows, type RankingRow } from './lib/jp-ranking'
import {
  CHEAP_RANGE_PERCENTILE,
  RANKING_DOWN_PAGES,
  RANKING_VOLUME_PAGES,
  SHORTLIST_SIZE,
  SPARK_BATCH_CHUNK,
  SUBREQUEST_COST_PER_FETCH,
} from '../../shared/constants'
import type { Env } from './lib/env'

/**
 * Cloudflare Workers 無料プランの subrequest 上限。
 * ここを超えると Cloudflare 側で "Too many subrequests" となり、
 * ハンドラごと 502 になる（実際にこの障害が起きていた）。
 * ローカルでは上限が再現しないため、このテストが唯一の回帰防止線になる。
 */
const CLOUDFLARE_FREE_SUBREQUEST_LIMIT = 50

/** Yahoo!ファイナンスのランキング表 1 行分の HTML を組み立てる */
function rankingRowHtml(index: number, changePercent: number): string {
  const code = String(1300 + index).padStart(4, '0')
  const price = 500 + index
  return [
    '<tr class="RankingTable__row__2x8_">',
    `<th scope="row" class="RankingTable__head__2gX2">${index + 1}</th>`,
    '<td class="RankingTable__detail__16ZL">',
    `<a href="https://finance.yahoo.co.jp/quote/${code}.T" data-cl-params="_cl_link:name">テスト銘柄${index}</a>`,
    '<ul class="RankingTable__supplements__8-Ek">',
    `<li class="RankingTable__supplement__2s-i">${code}</li>`,
    '<li class="RankingTable__supplement__2s-i">東証PRM</li>',
    '</ul></td>',
    `<td class="RankingTable__detail__16ZL"><span class="StyledNumber__value__zj25">${price}</span><span class="RankingTable__date__3uPN">09/09</span></td>`,
    `<td class="RankingTable__detail__16ZL"><span class="StyledNumber__value__zj25">-10</span><span class="StyledNumber__value__zj25">${changePercent.toFixed(2)}</span><span class="StyledNumber__suffix__2KxK">%</span></td>`,
    '<td class="RankingTable__detail__16ZL"><span class="StyledNumber__value__zj25">1,200,000</span><span>株</span></td>',
    '</tr>',
  ].join('')
}

function rankingPageHtml(rowCount = 50): string {
  const rows = Array.from({ length: rowCount }, (_, index) =>
    rankingRowHtml(index, -1 - (index % 15)),
  )
  return `<html><body><table>${rows.join('')}</table></body></html>`
}

/**
 * spark の応答（シンボルをキーにしたフラットマップ形式）。
 * 割安判定には2年分の履歴が要るので、高値をつけたあと下げて
 * 安値圏で下げ止まった形（＝買い候補になる形）を約500本で作る。
 */
function sparkPayload(symbols: string[]): string {
  const payload: Record<string, { symbol: string; close: number[] }> = {}
  for (const symbol of symbols) {
    const closes: number[] = []
    let value = 500
    for (let index = 0; index < 250; index += 1) {
      value *= 1.004
      closes.push(value)
    }
    for (let index = 0; index < 230; index += 1) {
      value *= 0.997
      closes.push(value)
    }
    for (let index = 0; index < 20; index += 1) {
      value *= 1.003
      closes.push(value)
    }
    payload[symbol] = { symbol, close: closes }
  }
  return JSON.stringify(payload)
}

function createContext(url: string, ip: string) {
  const waited: Promise<unknown>[] = []
  return {
    request: new Request(url, { headers: { 'cf-connecting-ip': ip } }),
    env: {} as Env,
    waitUntil: (promise: Promise<unknown>) => {
      waited.push(promise)
    },
    waited,
  }
}

describe('GET /api/candidates', () => {
  let fetchCalls: string[]

  beforeEach(() => {
    fetchCalls = []
    // Cache API は使えない環境として振る舞わせる（予算計算は保守的な見積もりのまま）
    vi.stubGlobal('caches', undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        fetchCalls.push(url)

        if (url.includes('finance.yahoo.co.jp/stocks/ranking')) {
          return new Response(rankingPageHtml(), { status: 200 })
        }
        if (url.includes('/v8/finance/spark')) {
          const symbols = decodeURIComponent(
            new URL(url).searchParams.get('symbols') ?? '',
          ).split(',')
          return new Response(sparkPayload(symbols), { status: 200 })
        }
        return new Response('{}', { status: 200 })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('キャッシュが空でも Cloudflare の subrequest 上限を超えない', async () => {
    const context = createContext('https://example.com/api/candidates', '203.0.113.1')
    const response = await onRequestGet(context as never)

    expect(response.status).toBe(200)

    // 外部取得 1 件あたり fetch + Cache API(match/put) で最大 3 subrequest
    const estimated = fetchCalls.length * SUBREQUEST_COST_PER_FETCH
    expect(estimated).toBeLessThanOrEqual(CLOUDFLARE_FREE_SUBREQUEST_LIMIT)

    // 内訳: ランキング 8 ページ + spark（60銘柄 ÷ 20）3 リクエスト
    const rankingCalls = fetchCalls.filter((url) => url.includes('/stocks/ranking')).length
    const sparkCalls = fetchCalls.filter((url) => url.includes('/finance/spark')).length
    expect(rankingCalls).toBe(RANKING_DOWN_PAGES + RANKING_VOLUME_PAGES)
    expect(sparkCalls).toBeLessThanOrEqual(Math.ceil(SHORTLIST_SIZE / SPARK_BATCH_CHUNK))
  })

  it('候補はすべて当日下落しており、割安と判定されている', async () => {
    const context = createContext('https://example.com/api/candidates', '203.0.113.2')
    const response = await onRequestGet(context as never)
    const payload = (await response.json()) as {
      candidates: Array<{
        return1d: number
        category: string
        valuation: { rangePercentile: number } | null
      }>
      summary: { scanned: number; declining: number; analyzed: number }
    }

    expect(payload.candidates.length).toBeGreaterThan(0)
    for (const candidate of payload.candidates) {
      expect(candidate.return1d).toBeLessThan(0)
      // 「今日下がっただけ」の銘柄を候補にしない（割安さが主軸）
      expect(candidate.valuation).not.toBeNull()
      expect(candidate.valuation?.rangePercentile).toBeLessThanOrEqual(CHEAP_RANGE_PERCENTILE)
    }
    expect(payload.summary.scanned).toBeGreaterThan(0)
    expect(payload.summary.analyzed).toBeGreaterThan(0)
  })

  it('2回目はキャッシュから返し、外部取得を行わない', async () => {
    // 他のテストと共有しないキャッシュキーを使う（登録銘柄ごとにキーが分かれる）
    const url = 'https://example.com/api/candidates?symbols=1301'
    await onRequestGet(createContext(url, '203.0.113.3') as never)
    const firstCallCount = fetchCalls.length
    expect(firstCallCount).toBeGreaterThan(0)

    await onRequestGet(createContext(url, '203.0.113.4') as never)
    expect(fetchCalls.length).toBe(firstCallCount)
  })

  it('ランキングに載っていない登録銘柄も一覧に出る', async () => {
    // ランキング表のテストデータは 1300〜1349。5451 は載っていない。
    // 以前は一次選抜の中でしか登録銘柄を拾っておらず、この銘柄は一覧から消えていた
    // （実際に、個別株調査で登録したヨドコウ 5451 が候補抽出の登録銘柄に出なかった）。
    const context = createContext(
      'https://example.com/api/candidates?symbols=5451',
      '203.0.113.6',
    )
    const response = await onRequestGet(context as never)
    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      candidates: Array<{ code: string; volume: number; segment: string }>
      missingRegistered?: string[]
      registeredCount: number
    }
    const registered = payload.candidates.find((item) => item.code === '5451.T')
    expect(registered).toBeDefined()
    // 出来高はランキング表からしか取れないので不明（0）
    expect(registered?.volume).toBe(0)
    expect(payload.registeredCount).toBe(1)
    expect(payload.missingRegistered).toEqual([])
  })

  it('登録銘柄の履歴だけ取得できなくても一覧全体は返し、取れなかった銘柄を知らせる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        fetchCalls.push(url)
        if (url.includes('finance.yahoo.co.jp/stocks/ranking')) {
          return new Response(rankingPageHtml(), { status: 200 })
        }
        if (url.includes('/v8/finance/spark')) {
          const symbols = decodeURIComponent(new URL(url).searchParams.get('symbols') ?? '').split(',')
          // 登録銘柄だけの取得は失敗させる
          if (symbols.length === 1 && symbols[0] === '9998.T') {
            return new Response('boom', { status: 500 })
          }
          return new Response(sparkPayload(symbols), { status: 200 })
        }
        return new Response('{}', { status: 200 })
      }),
    )

    const context = createContext(
      'https://example.com/api/candidates?symbols=9998',
      '203.0.113.7',
    )
    const response = await onRequestGet(context as never)
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      candidates: unknown[]
      missingRegistered?: string[]
    }
    expect(payload.candidates.length).toBeGreaterThan(0)
    expect(payload.missingRegistered).toEqual(['9998.T'])
  })

  it('キャッシュから返せる要求にはレート制限をかけない', async () => {
    // 登録を続けて追加すると同じ一覧を何度も要求する。以前は9回目で 429 になっていた
    const url = 'https://example.com/api/candidates?symbols=1302'
    const statuses: number[] = []
    for (let index = 0; index < 12; index += 1) {
      const response = await onRequestGet(createContext(url, '203.0.113.8') as never)
      statuses.push(response.status)
    }
    expect(statuses.every((status) => status === 200)).toBe(true)
  })

  it('ランキング取得が全滅しても 502 ではなく空の結果を返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    )

    const context = createContext(
      'https://example.com/api/candidates?symbols=9999',
      '203.0.113.5',
    )
    const response = await onRequestGet(context as never)
    expect(response.status).toBe(200)

    const payload = (await response.json()) as { candidates: unknown[] }
    expect(payload.candidates).toEqual([])
  })
})

describe('parseRankingRows', () => {
  it('社名・コード・市場区分・株価・騰落率・出来高を取り出す', () => {
    const rows = parseRankingRows(rankingPageHtml(1))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      code: '1300.T',
      name: 'テスト銘柄0',
      segment: 'プライム',
      close: 500,
      return1d: -0.01,
      volume: 1_200_000,
    })
  })

  it('ETF など個別株でないものを除外する', () => {
    const html = rankingPageHtml(1).replace('テスト銘柄0', 'NEXT FUNDS 日経225連動型上場投信')
    expect(parseRankingRows(html)).toEqual([])
  })
})

describe('buildShortlist', () => {
  const row = (code: string, return1d: number, close: number, volume: number): RankingRow => ({
    code,
    name: code,
    segment: 'プライム',
    close,
    return1d,
    volume,
  })

  it('当日上昇している銘柄は一次選抜に含めない', () => {
    const rows = [
      row('1000.T', 0.03, 1000, 1_000_000),
      row('1001.T', -0.03, 1000, 1_000_000),
    ]
    const picked = buildShortlist(rows)
    expect(picked.map((item) => item.code)).toEqual(['1001.T'])
  })

  it('売買代金が小さすぎる銘柄は除外する', () => {
    const rows = [
      row('1000.T', -0.05, 100, 100), // 売買代金 1万円
      row('1001.T', -0.01, 1000, 1_000_000),
    ]
    const picked = buildShortlist(rows)
    expect(picked.map((item) => item.code)).toEqual(['1001.T'])
  })

  it('分析件数は上限を超えない', () => {
    const rows = Array.from({ length: 300 }, (_, index) =>
      row(`${2000 + index}.T`, -0.01 - index / 10000, 1000, 1_000_000),
    )
    expect(buildShortlist(rows).length).toBeLessThanOrEqual(SHORTLIST_SIZE)
  })
})

describe('resolveRegistered', () => {
  it('日本株の4桁コードだけを正準化して受け付ける', () => {
    const url = new URL('https://example.com/api/candidates?symbols=7203,5451.T,AAPL,7203,12345')
    expect(resolveRegistered(url)).toEqual(['5451.T', '7203.T'])
  })

  it('指定がなければ空配列', () => {
    expect(resolveRegistered(new URL('https://example.com/api/candidates'))).toEqual([])
  })
})

describe('todayFromHistory', () => {
  it('履歴の末尾2本から終値と騰落率を求め、出来高は不明（0）にする', () => {
    const today = todayFromHistory([100, 102, 99])
    expect(today?.close).toBe(99)
    expect(today?.return1d).toBeCloseTo(99 / 102 - 1, 10)
    expect(today?.volume).toBe(0)
  })

  it('履歴が1本以下なら null', () => {
    expect(todayFromHistory([100])).toBeNull()
    expect(todayFromHistory([])).toBeNull()
  })
})
