import { describe, expect, it } from 'vitest'
import { buildExternalLinks } from './links'

describe('buildExternalLinks', () => {
  it('`7203` と `7203.T` で同じURLになる', () => {
    expect(buildExternalLinks('7203')).toEqual(buildExternalLinks('7203.T'))
  })

  it('主要サイトのURLを組み立てる', () => {
    const byId = new Map(buildExternalLinks('7203').map((link) => [link.id, link.url]))
    expect(byId.get('yahoo')).toBe('https://finance.yahoo.co.jp/quote/7203.T')
    expect(byId.get('minkabu')).toBe('https://minkabu.jp/stock/7203')
    expect(byId.get('kabutan')).toBe('https://kabutan.jp/stock/?code=7203')
    expect(byId.get('moomoo')).toBe('https://www.moomoo.com/ja/stock/7203-JP')
    expect(byId.get('rakuten')).toContain('ric=7203.T')
    expect(byId.get('sbi')).toContain('i_stock_sec=7203')
  })

  it('すべて https の絶対URLになる', () => {
    for (const link of buildExternalLinks('6501')) {
      expect(link.url.startsWith('https://')).toBe(true)
      expect(link.label.length).toBeGreaterThan(0)
    }
  })

  it('日本株でなければ空配列（米国株や不正な入力でリンクを作らない）', () => {
    expect(buildExternalLinks('AAPL')).toEqual([])
    expect(buildExternalLinks('')).toEqual([])
    expect(buildExternalLinks('12345')).toEqual([])
    expect(buildExternalLinks('abc')).toEqual([])
  })
})
