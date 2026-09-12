import { describe, expect, it } from 'vitest'
import { hasNoAnalystCoverage, parseAnalystConsensus, parseBreakdown } from './minkabu'

/** 実際のみんかぶページと同じ構造を最小限で再現する */
function samplePage(options: { breakdown?: string; targetPrice?: string } = {}): string {
  const breakdown = options.breakdown ?? '強気買い10人、買い4人、中立5人となっています'
  const target = options.targetPrice ?? '3,699'
  return [
    '<html><body>',
    '<div class="md_sub_index"><h2>トヨタ自動車の証券アナリスト予想詳細</h2></div>',
    `<p>2026/09/12時点における、トヨタに対する、アナリスト判断（コンセンサス）は、買い。内訳は、${breakdown}。`,
    `アナリストの平均目標株価は${target}円で、株価はあと22.00%上昇すると予想しています。</p>`,
    '<table class="md_table is_fix rnk_li"><tbody>',
    '<tr><th class="fsm w100p"></th><th class="fsm">3ヶ月前</th><th class="fsm">1ヶ月前</th><th class="fsm">1週間前</th><th class="fsm">最新</th></tr>',
    '<tr><th class="tac w200p">評価</th>',
    '<td><div class="md_picksPlate theme_buy">買い</div></td><td><div class="md_picksPlate theme_buy">買い</div></td>',
    '<td><div class="md_picksPlate theme_buy">買い</div></td><td><div class="md_picksPlate theme_buy">買い</div></td></tr>',
    '<tr><th class="tac">予想株価</th>',
    '<td class="tac">\n 3,736\n </td><td class="tac">\n 3,626\n </td>',
    '<td class="tac">\n 3,699\n </td><td class="tac fwb fsn">\n 3,699\n </td></tr>',
    '</tbody></table>',
    '<div class="md_memo">「アナリストの予想株価」は、予想時点から1年後の株価を予想しています。</div>',
    '<table><tbody>',
    '<tr><th>売上高</th><td>52,555,457</td><td>53,660,427</td><td>54,008,821</td><td>54,008,795</td><td>54,000,000</td></tr>',
    '<tr><th>当期利益</th><td>3,743,555</td><td>3,635,171</td><td>3,730,432</td><td>3,763,304</td><td>3,250,000</td></tr>',
    '<tr><th>1株当り利益</th><td>308.69</td><td>300.77</td><td>310.28</td><td>310.28</td><td>275.11</td></tr>',
    '</tbody></table>',
    '</body></html>',
  ].join('\n')
}

describe('parseBreakdown', () => {
  it('人数を区分ごとに分解する', () => {
    expect(parseBreakdown('強気買い10人、買い4人、中立5人')).toEqual({
      strongBuy: 10,
      buy: 4,
      hold: 5,
    })
  })

  it('「強気買い」を「買い」として二重に数えない', () => {
    // 部分一致で拾うと strongBuy と buy が同じ数になる
    const result = parseBreakdown('強気買い7人、買い4人、中立2人')
    expect(result?.strongBuy).toBe(7)
    expect(result?.buy).toBe(4)
  })

  it('売り側も取り出す', () => {
    expect(parseBreakdown('強気買い1人、買い2人、中立3人、売り4人、強気売り5人')).toEqual({
      strongBuy: 1,
      buy: 2,
      hold: 3,
      sell: 4,
      strongSell: 5,
    })
  })

  it('該当がなければ undefined（0で埋めない）', () => {
    expect(parseBreakdown('データがありません')).toBeUndefined()
  })
})

describe('parseAnalystConsensus', () => {
  const consensus = parseAnalystConsensus(samplePage())

  it('判断・時点・平均目標株価を取り出す', () => {
    expect(consensus?.asOf).toBe('2026/09/12')
    expect(consensus?.judgement).toBe('買い')
    expect(consensus?.targetPrice).toBe(3699)
  })

  it('上昇余地を比率で返す', () => {
    expect(consensus?.upside).toBeCloseTo(0.22, 6)
  })

  it('人数の内訳を取り出す', () => {
    expect(consensus?.breakdown).toEqual({ strongBuy: 10, buy: 4, hold: 5 })
  })

  it('目標株価の推移を4点取り出す', () => {
    expect(consensus?.trend).toEqual([
      { label: '3ヶ月前', targetPrice: 3736 },
      { label: '1ヶ月前', targetPrice: 3626 },
      { label: '1週間前', targetPrice: 3699 },
      { label: '最新', targetPrice: 3699 },
    ])
  })

  it('アナリスト予想EPSと会社予想EPSを取り出す', () => {
    expect(consensus?.eps).toEqual({ analyst: 310.28, company: 275.11 })
  })

  it('目標株価が1年後予想であることを注記として持つ', () => {
    expect(consensus?.horizonNote).toContain('1年後')
    expect(consensus?.source).toBe('みんかぶ')
  })

  it('該当する文がなければ undefined（推測で埋めない）', () => {
    expect(parseAnalystConsensus('<html><body>なにもない</body></html>')).toBeUndefined()
  })

  it('目標株価が数値として読めなければ undefined', () => {
    const html = samplePage().replace('平均目標株価は3,699円', '平均目標株価は--円')
    expect(parseAnalystConsensus(html)).toBeUndefined()
  })

  it('推移テーブルが欠けても、本文から取れる分は返す', () => {
    const html = samplePage().replace(/<table class="md_table is_fix rnk_li">[\s\S]*?<\/table>/, '')
    const partial = parseAnalystConsensus(html)
    expect(partial?.targetPrice).toBe(3699)
    expect(partial?.trend).toBeUndefined()
  })
})

describe('hasNoAnalystCoverage', () => {
  it('カバーしているアナリストがいないページを見分ける', () => {
    // 小型株では珍しくない。取得失敗と区別して画面の文言を変えるために使う
    expect(hasNoAnalystCoverage('<p>アナリスト予想はありません</p>')).toBe(true)
  })

  it('通常のページでは false', () => {
    expect(hasNoAnalystCoverage(samplePage())).toBe(false)
  })
})
