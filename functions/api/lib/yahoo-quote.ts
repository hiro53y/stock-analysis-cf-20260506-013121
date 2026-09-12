import type { StockDetail } from '../../../shared/types'

/**
 * Yahoo!ファイナンス（日本）の銘柄ページから参考指標と業績評価を取り出す。
 *
 * このページ1回の取得で PER・PBR・配当利回り・EPS・BPS・ROE・自己資本比率・
 * 時価総額・単元株数・最低購入代金・直近決算の要約・〈収益性〉〈安定性〉〈成長性〉の
 * 評価文がすべて手に入る。追加のリクエストは不要。
 *
 * 実装上の注意（実際のHTMLを調べて判明したもの）:
 *
 * 1. クラス名には `_DataListItem__name_13tc9_19` のようにビルドごとに変わるハッシュが付く。
 *    ハッシュ部分は `[^"]*` で吸収しないと、Yahoo の再デプロイで無言のうちに壊れる。
 * 2. `PER` は2回出現する。2つ目は「（過去3年平均）」で VIP 会員限定のため
 *    ロックされており、HTML には `000.00` というダミー値が入っている。
 *    ラベルだけで拾うと必ずこのダミーを踏むので、`（会社予想）` まで含めて特定する。
 * 3. 値の直前に `(連)` という prefix span が入る。`_DataListItem__value_` を
 *    明示的に狙わないと `(連)` を数値として拾ってしまう。
 * 4. 取得・解析に失敗した項目は undefined のままにする。推測で埋めない。
 */

/** `1,234.56` のような表記を数値へ。解析できなければ undefined。 */
function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const cleaned = raw.replace(/,/g, '').trim()
  if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return undefined
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `<dt>` のラベル（と補足）に一致する項目を探し、続く `<dd>` の値を返す。
 * VIP 限定でロックされた項目は飛ばして次の候補を見る。
 */
function readDataListValue(html: string, label: string, sub?: string): string | undefined {
  const labelPattern = sub
    ? `_DataListItem__name_[^"]*">${escapeRegExp(label)}</span><span class="_DataListItem__sub_[^"]*">（${escapeRegExp(sub)}）</span>`
    : `_DataListItem__name_[^"]*">${escapeRegExp(label)}</span>`

  const finder = new RegExp(labelPattern, 'g')
  const valuePattern = /_DataListItem__value_[^"]*">([^<]+)<\/span>/

  let match: RegExpExecArray | null
  while ((match = finder.exec(html)) !== null) {
    const segment = html.slice(match.index + match[0].length, match.index + match[0].length + 1500)
    // VIP 会員限定の項目はダミー値が入っているため使わない
    if (segment.slice(0, 500).includes('_DataListItem__description--locked')) continue
    const value = valuePattern.exec(segment)
    if (value) return value[1].trim()
  }
  return undefined
}

function readNumber(html: string, label: string, sub?: string): number | undefined {
  return toNumber(readDataListValue(html, label, sub))
}

/** `<dt>〈収益性〉</dt><dd>…</dd>` 形式の評価文を取り出す。 */
function readHealthText(html: string, label: string): string | undefined {
  const pattern = new RegExp(`<dt[^>]*>〈${label}〉</dt><dd[^>]*>([\\s\\S]{0,800}?)</dd>`)
  const match = pattern.exec(html)
  if (!match) return undefined
  const text = match[1]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || undefined
}

/**
 * ページに埋め込まれた RSC ストリーム（エスケープ済みJSON）から決算要約を取り出す。
 * 実体は `\"summary\":{\"summary\":\"…\"` のように二重エスケープされている。
 */
function readEarningsSummary(html: string): { summary?: string; disclosedAt?: string } {
  const disclosed = /\\"disclosedTime\\":\\"([^"\\]+)\\"/.exec(html)
  const summary = /\\"summary\\":\{\\"summary\\":\\"([^"\\]+)\\"/.exec(html)
  return {
    summary: summary?.[1]?.trim() || undefined,
    disclosedAt: disclosed?.[1]?.trim() || undefined,
  }
}

function readCompanyName(html: string): string | undefined {
  const title = /<title>([^<]+)<\/title>/.exec(html)
  if (!title) return undefined
  // 例: 「トヨタ自動車(株)【7203】：株価・株式情報 - Yahoo!ファイナンス」
  const name = title[1].split(/【|：|\|/)[0].trim()
  return name || undefined
}

export function parseStockDetail(html: string, code: string): StockDetail {
  const health = {
    profitability: readHealthText(html, '収益性'),
    stability: readHealthText(html, '安定性'),
    growth: readHealthText(html, '成長性'),
  }
  const earnings = readEarningsSummary(html)

  const detail: StockDetail = {
    code,
    name: readCompanyName(html),
    per: readNumber(html, 'PER', '会社予想'),
    pbr: readNumber(html, 'PBR', '実績'),
    dividendYield: readNumber(html, '配当利回り', '会社予想'),
    dividendPerShare: readNumber(html, '1株配当', '会社予想'),
    eps: readNumber(html, 'EPS', '会社予想'),
    bps: readNumber(html, 'BPS', '実績'),
    roe: readNumber(html, 'ROE', '実績'),
    equityRatio: readNumber(html, '自己資本比率', '実績'),
    marketCapMillionYen: readNumber(html, '時価総額'),
    sharesPerLot: readNumber(html, '単元株数'),
    minimumPurchaseYen: readNumber(html, '最低購入代金'),
    earningsSummary: earnings.summary,
    earningsDisclosedAt: earnings.disclosedAt,
    health: health.profitability || health.stability || health.growth ? health : undefined,
    partial: false,
  }

  // partial は「解析に失敗した」ことを表す。値が存在しないことと混同しない。
  //
  // 配当利回り・1株配当は、無配や未定の銘柄では Yahoo 側が `---` を出す（例: 6501）。
  // これを「取得できなかった」と表示すると、実際には正しく読めているのに
  // 不具合のように見えてしまう。ページ構造が変わったときだけ立てたいので、
  // どの銘柄にも必ずあるはずの項目が揃って取れなかった場合に限る。
  detail.partial =
    (detail.per === undefined && detail.pbr === undefined) ||
    detail.minimumPurchaseYen === undefined

  return detail
}
