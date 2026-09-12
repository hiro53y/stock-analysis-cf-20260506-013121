import { describe, expect, it } from 'vitest'
import { parseStockDetail } from './yahoo-quote'

/**
 * 実際の Yahoo!ファイナンス銘柄ページと同じ構造を最小限で再現する。
 * クラス名のハッシュ（_13tc9_19 など）はビルドごとに変わるため、
 * テストでは実物と違うハッシュをわざと使い、パーサがハッシュに依存していないことを確かめる。
 */
function dataListItem(
  label: string,
  sub: string | null,
  value: string,
  options: { prefix?: string; locked?: boolean } = {},
): string {
  const hash = 'zz9q9_' + label.length
  const term = sub
    ? `<a href="/quote/7203.T/history"><span class="_DataListItem__name_${hash}">${label}</span><span class="_DataListItem__sub_${hash}">（${sub}）</span></a>`
    : `<span class="_DataListItem__name_${hash}">${label}</span>`
  const descriptionClass = options.locked
    ? `_DataListItem__description_${hash} _DataListItem__description--locked_${hash}`
    : `_DataListItem__description_${hash}`
  const prefix = options.prefix
    ? `<span class="_StyledNumber__prefix_ab1_9 _DataListItem__prefix_${hash}">${options.prefix}</span>`
    : ''
  return [
    `<dl class="_DataListItem_${hash}"><dt class="_DataListItem__term_${hash}">${term}</dt>`,
    `<dd class="${descriptionClass}"><span class="_StyledNumber_ab1_1"><span class="_StyledNumber__item_ab1_6">`,
    prefix,
    `<span class="_StyledNumber__value_ab1_9 _DataListItem__value_${hash}">${value}</span>`,
    '</span></span></dd></dl>',
  ].join('')
}

function samplePage(): string {
  return [
    '<html><head><title>トヨタ自動車(株)【7203】：株価・株式情報 - Yahoo!ファイナンス</title></head><body>',
    dataListItem('時価総額', null, '43,697,392'),
    dataListItem('配当利回り', '会社予想', '3.34'),
    dataListItem('1株配当', '会社予想', '100.00'),
    // 実物と同じ順序: 会社予想が先、VIP限定のダミーが後
    dataListItem('PER', '会社予想', '11.27', { prefix: '(連)' }),
    dataListItem('PER', '過去3年平均', '000.00', { locked: true }),
    dataListItem('PBR', '実績', '0.95', { prefix: '(連)' }),
    dataListItem('EPS', '会社予想', '265.55', { prefix: '(連)' }),
    dataListItem('BPS', '実績', '3,150.60', { prefix: '(連)' }),
    dataListItem('ROE', '実績', '10.15', { prefix: '(連)' }),
    dataListItem('自己資本比率', '実績', '37.8', { prefix: '(連)' }),
    dataListItem('単元株数', null, '100'),
    dataListItem('最低購入代金', null, '299,400'),
    '<dl><dt class="x">〈収益性〉</dt><dd class="y">悪化しています。<!-- -->純利益率が低下しています。</dd></dl>',
    '<dl><dt class="x">〈安定性〉</dt><dd class="y">やや低下しています。</dd></dl>',
    '<dl><dt class="x">〈成長性〉</dt><dd class="y">伸び悩んでいます。</dd></dl>',
    '<script>self.__next_f.push([1,"pressReleaseSummary\\":{\\"disclosedTime\\":\\"2026-08-04T14:00:00+09:00\\",\\"summary\\":{\\"summary\\":\\"営業収益が10.4%増の一方、営業利益は8.8%減でした。\\",\\"segment\\":\\"自動車事業ほか\\"}"])</script>',
    '</body></html>',
  ].join('')
}

describe('parseStockDetail', () => {
  const detail = parseStockDetail(samplePage(), '7203.T')

  it('参考指標を数値として取り出す', () => {
    expect(detail.per).toBe(11.27)
    expect(detail.pbr).toBe(0.95)
    expect(detail.dividendYield).toBe(3.34)
    expect(detail.dividendPerShare).toBe(100)
    expect(detail.eps).toBe(265.55)
    expect(detail.bps).toBe(3150.6)
    expect(detail.roe).toBe(10.15)
    expect(detail.equityRatio).toBe(37.8)
    expect(detail.marketCapMillionYen).toBe(43_697_392)
    expect(detail.sharesPerLot).toBe(100)
    expect(detail.minimumPurchaseYen).toBe(299_400)
  })

  it('VIP会員限定のダミー値（PER 過去3年平均の 000.00）を拾わない', () => {
    // 「PER」だけで最初に一致した項目を返すと 000.00 を踏む
    expect(detail.per).not.toBe(0)
    expect(detail.per).toBe(11.27)
  })

  it('(連) のような prefix を数値に混ぜない', () => {
    expect(detail.pbr).toBe(0.95)
    expect(detail.eps).toBe(265.55)
  })

  it('クラス名のハッシュが変わってもパースできる', () => {
    // 実際の Yahoo は _13tc9_19 のようなハッシュを使うが、ここでは別のハッシュを使っている
    expect(detail.per).toBeDefined()
    expect(detail.minimumPurchaseYen).toBeDefined()
  })

  it('業績評価テキストを取り出す（HTMLコメントは除去する）', () => {
    expect(detail.health?.profitability).toBe('悪化しています。純利益率が低下しています。')
    expect(detail.health?.stability).toBe('やや低下しています。')
    expect(detail.health?.growth).toBe('伸び悩んでいます。')
  })

  it('決算要約と開示日時を取り出す', () => {
    expect(detail.earningsSummary).toBe('営業収益が10.4%増の一方、営業利益は8.8%減でした。')
    expect(detail.earningsDisclosedAt).toBe('2026-08-04T14:00:00+09:00')
  })

  it('会社名をタイトルから取り出す', () => {
    expect(detail.name).toBe('トヨタ自動車(株)')
  })

  it('主要指標がそろっていれば partial は false', () => {
    expect(detail.partial).toBe(false)
  })

  it('取得できない項目は undefined のままにし、推測で埋めない', () => {
    const empty = parseStockDetail('<html><body>なにもない</body></html>', '9999.T')
    expect(empty.per).toBeUndefined()
    expect(empty.pbr).toBeUndefined()
    expect(empty.minimumPurchaseYen).toBeUndefined()
    expect(empty.health).toBeUndefined()
    expect(empty.partial).toBe(true)
  })

  it('数値として解釈できない表記は取り込まない', () => {
    const html = samplePage().replace('>11.27<', '>---<')
    const broken = parseStockDetail(html, '7203.T')
    expect(broken.per).toBeUndefined()
  })

  it('無配銘柄のように配当が `---` でも partial にはしない', () => {
    // 6501 は Yahoo 側が配当利回り・1株配当に `---` を出す。
    // 正しく読めているのに「取得できなかった」と表示しないこと。
    const html = samplePage().replace('>3.34<', '>---<').replace('>100.00<', '>---<')
    const detail = parseStockDetail(html, '6501.T')
    expect(detail.dividendYield).toBeUndefined()
    expect(detail.per).toBe(11.27)
    expect(detail.partial).toBe(false)
  })

  it('ページ構造が変わって主要指標が総崩れなら partial にする', () => {
    const html = samplePage().replace(/_DataListItem__value_/g, '_Changed__value_')
    const detail = parseStockDetail(html, '7203.T')
    expect(detail.per).toBeUndefined()
    expect(detail.pbr).toBeUndefined()
    expect(detail.partial).toBe(true)
  })
})
