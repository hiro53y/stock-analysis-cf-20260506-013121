import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet } from './candidates'
import { buildShortlist } from './candidates'
import { parseRankingRows, type RankingRow } from './lib/jp-ranking'
import {
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

/** spark の応答（シンボルをキーにしたフラットマップ形式） */
function sparkPayload(symbols: string[]): string {
  const payload: Record<string, { symbol: string; close: number[] }> = {}
  for (const symbol of symbols) {
    const closes: number[] = []
    let value = 500
    for (let index = 0; index < 120; index += 1) {
      value *= index % 6 === 5 ? 0.99 : 1.005
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

  it('候補はすべて当日下落している（画面の説明と一致する）', async () => {
    const context = createContext('https://example.com/api/candidates', '203.0.113.2')
    const response = await onRequestGet(context as never)
    const payload = (await response.json()) as {
      candidates: Array<{ return1d: number; category: string }>
      summary: { scanned: number; declining: number; analyzed: number }
    }

    expect(payload.candidates.length).toBeGreaterThan(0)
    for (const candidate of payload.candidates) {
      expect(candidate.return1d).toBeLessThan(0)
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
    const picked = buildShortlist(rows, new Set())
    expect(picked.map((item) => item.code)).toEqual(['1001.T'])
  })

  it('売買代金が小さすぎる銘柄は除外する', () => {
    const rows = [
      row('1000.T', -0.05, 100, 100), // 売買代金 1万円
      row('1001.T', -0.01, 1000, 1_000_000),
    ]
    const picked = buildShortlist(rows, new Set())
    expect(picked.map((item) => item.code)).toEqual(['1001.T'])
  })

  it('登録銘柄は流動性や騰落にかかわらず必ず含める', () => {
    const rows = [
      row('1000.T', 0.05, 100, 100), // 上昇かつ低流動性
      row('1001.T', -0.01, 1000, 1_000_000),
    ]
    const picked = buildShortlist(rows, new Set(['1000.T']))
    expect(picked.map((item) => item.code).sort()).toEqual(['1000.T', '1001.T'])
  })

  it('分析件数は上限を超えない', () => {
    const rows = Array.from({ length: 300 }, (_, index) =>
      row(`${2000 + index}.T`, -0.01 - index / 10000, 1000, 1_000_000),
    )
    expect(buildShortlist(rows, new Set()).length).toBeLessThanOrEqual(SHORTLIST_SIZE)
  })
})
