import { buildExternalLinks } from '../../shared/links'
import type { AnalystConsensus, StockDetail, TrackRecord } from '../../shared/types'
import { formatCompactNumber, formatReturn, formatYenScale } from '../../shared/utils'

interface StockDetailPanelProps {
  detail: StockDetail | null
  state: 'idle' | 'loading' | 'error'
  /** 上昇余地を自前で出すための現在株価 */
  currentPrice: number
  onRetry: () => void
}

function returnClass(value: number): string {
  if (value > 0) return 'delta-up'
  if (value < 0) return 'delta-down'
  return 'delta-flat'
}

function formatMultiple(value: number | undefined, unit: string): string | null {
  if (value === undefined) return null
  return `${value.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}${unit}`
}

/** 「買い」「中立」などの判断を配色クラスへ */
function judgementClass(judgement: string): string {
  if (judgement.includes('売り')) return 'judge-sell'
  if (judgement.includes('買い')) return 'judge-buy'
  return 'judge-hold'
}

/**
 * その銘柄の外部サイトへのリンク。
 *
 * 証券会社のアナリスト評価はログイン領域にあり、サーバーからは取得できない。
 * ただし利用者のブラウザは多くの場合ログイン済みなので、該当銘柄のページへ
 * 直接飛べるようにしておけば、会員向けの評価をそのまま見られる。
 */
export function ExternalLinkRow({ code }: { code: string }) {
  const links = buildExternalLinks(code)
  if (links.length === 0) return null

  return (
    <section className="sheet-block">
      <h4 className="sheet-title">外部サイトで確認する</h4>
      <ul className="external-links">
        {links.map((link) => (
          <li key={link.id}>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              <span className="external-link-label">{link.label}</span>
              <span className="external-link-hint">{link.hint}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 証券アナリストのコンセンサス。
 *
 * 目標株価は「予想時点から1年後」の予想で、本アプリ自身の目標（約1か月）とは
 * 時間軸が違う。同じ画面に並ぶため、見出しと注記で必ず区別する。
 */
function AnalystBlock({
  consensus,
  currentPrice,
}: {
  consensus: AnalystConsensus
  currentPrice: number
}) {
  const upside =
    consensus.upside ?? (currentPrice > 0 ? consensus.targetPrice / currentPrice - 1 : undefined)

  const { breakdown, trend, eps } = consensus
  const voters: Array<[string, number]> = []
  if (breakdown) {
    const entries: Array<[string, number | undefined]> = [
      ['強気買い', breakdown.strongBuy],
      ['買い', breakdown.buy],
      ['中立', breakdown.hold],
      ['売り', breakdown.sell],
      ['強気売り', breakdown.strongSell],
    ]
    for (const [label, count] of entries) {
      if (typeof count === 'number' && count > 0) voters.push([label, count])
    }
  }
  const totalVoters = voters.reduce((sum, [, count]) => sum + count, 0)

  // アナリスト予想が会社予想をどれだけ上回っているか（安くなった理由が業績かの手がかり）
  const epsGap =
    eps?.analyst !== undefined && eps.company !== undefined && eps.company !== 0
      ? eps.analyst / eps.company - 1
      : undefined

  return (
    <section className="sheet-block">
      <h4 className="sheet-title">証券アナリストの見方</h4>

      <div className="analyst-head">
        <span className={`analyst-judge ${judgementClass(consensus.judgement)}`}>
          {consensus.judgement}
        </span>
        <span className="analyst-target">
          目標 {formatCompactNumber(consensus.targetPrice)}円
          {upside !== undefined ? (
            <span className={`metric-note ${returnClass(upside)}`}>{formatReturn(upside)}</span>
          ) : null}
        </span>
      </div>

      {voters.length > 0 ? (
        <p className="analyst-voters">
          {totalVoters}人のうち{' '}
          {voters.map(([label, count], index) => (
            <span key={label}>
              {index > 0 ? ' / ' : ''}
              {label} <b>{count}</b>
            </span>
          ))}
        </p>
      ) : null}

      {trend && trend.length > 0 ? (
        <dl className="candidate-metrics">
          <div className="candidate-metric">
            <dt>目標株価の推移</dt>
            <dd className="analyst-trend">
              {trend.map((point) => (
                <span key={point.label}>
                  <small>{point.label}</small> {formatCompactNumber(point.targetPrice)}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      ) : null}

      {epsGap !== undefined ? (
        <p className="sheet-note">
          今期の1株利益は、アナリスト予想 {eps?.analyst?.toFixed(2)}円 に対し会社予想{' '}
          {eps?.company?.toFixed(2)}円。アナリストは会社予想を{' '}
          <b className={returnClass(epsGap)}>{formatReturn(epsGap)}</b> 見込んでいます。
        </p>
      ) : null}

      <p className="sheet-note muted">
        {consensus.asOf}時点 / 出典: {consensus.source}。この目標株価は{consensus.horizonNote}で、
        上の「目標（約1か月）」とは時間軸が異なります。本アプリの分類やスコアには使っていません。
      </p>
    </section>
  )
}

/**
 * 過去に安値圏へ下げたときの実績。
 *
 * 勝率と平均だけを見せると、地合いが良かっただけの銘柄を実力があると誤読させるため、
 * 条件なしで同じ期間を持った場合（ベースライン）と、その差を必ず併記する。
 */
export function TrackRecordBlock({ record }: { record: TrackRecord }) {
  return (
    <div className="track-record">
      <p className="track-lead">
        この銘柄が過去に安値圏で下げた <b>{record.samples}回</b>のうち、
        {record.horizonDays}営業日後に上昇していたのは{' '}
        <b>{(record.winRate * 100).toFixed(0)}%</b>（平均{' '}
        <b className={returnClass(record.averageReturn)}>{formatReturn(record.averageReturn)}</b>）。
      </p>
      <dl className="candidate-metrics">
        <div className="candidate-metric">
          <dt>条件なしの同期間平均</dt>
          <dd className={returnClass(record.baselineReturn)}>
            {formatReturn(record.baselineReturn)}
            <span className="metric-note">勝率 {(record.baselineWinRate * 100).toFixed(0)}%</span>
          </dd>
        </div>
        <div className="candidate-metric">
          <dt>実質の上乗せ</dt>
          <dd className={returnClass(record.edge)}>{formatReturn(record.edge)}</dd>
        </div>
        <div className="candidate-metric">
          <dt>保有中の最大下落（平均）</dt>
          <dd className="delta-down">{formatReturn(record.averageDrawdown)}</dd>
        </div>
      </dl>
      <p className="sheet-note muted">
        過去2年の同じ銘柄での傾向です。将来を保証するものではありません。
      </p>
    </div>
  )
}

/**
 * 銘柄ページから取得した参考指標・業績評価・アナリスト評価。
 * 取得できなかった項目は表示しない（空欄を数字で埋めない）。
 */
export function StockDetailPanel({ detail, state, currentPrice, onRetry }: StockDetailPanelProps) {
  if (state === 'loading') {
    return (
      <section className="sheet-block">
        <h4 className="sheet-title">割安さの裏づけ・なぜ下がったか</h4>
        <p className="sheet-note muted">読み込み中…</p>
      </section>
    )
  }

  if (state === 'error') {
    return (
      <section className="sheet-block">
        <h4 className="sheet-title">割安さの裏づけ・なぜ下がったか</h4>
        <p className="sheet-note muted">取得できませんでした。</p>
        <button type="button" className="secondary-button compact" onClick={onRetry}>
          再試行
        </button>
      </section>
    )
  }

  if (!detail) return null

  const figures: Array<[string, string]> = []
  const per = formatMultiple(detail.per, '倍')
  const pbr = formatMultiple(detail.pbr, '倍')
  if (per) figures.push(['PER（会社予想）', per])
  if (pbr) figures.push(['PBR（実績）', pbr])
  if (detail.dividendYield !== undefined) {
    figures.push(['配当利回り', `${detail.dividendYield.toFixed(2)}%`])
  }
  if (detail.roe !== undefined) figures.push(['ROE', `${detail.roe.toFixed(1)}%`])
  if (detail.equityRatio !== undefined) {
    figures.push(['自己資本比率', `${detail.equityRatio.toFixed(1)}%`])
  }
  if (detail.marketCapMillionYen !== undefined) {
    figures.push(['時価総額', formatYenScale(detail.marketCapMillionYen * 1_000_000)])
  }

  const health = detail.health
  const hasHealth = Boolean(health?.profitability || health?.stability || health?.growth)

  return (
    <>
      <section className="sheet-block">
        <h4 className="sheet-title">割安さの裏づけ・なぜ下がったか</h4>

        {figures.length > 0 ? (
          <dl className="candidate-metrics">
            {figures.map(([label, value]) => (
              <div className="candidate-metric" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="sheet-note muted">参考指標を取得できませんでした。</p>
        )}

        {/* 決算の長文は既定で畳む。カードの縦が伸びすぎると一覧に戻りにくくなる */}
        {detail.earningsSummary || hasHealth ? (
          <details className="earnings-details">
            <summary>直近決算の要約と業績評価</summary>
            {detail.earningsSummary ? (
              <p className="earnings-summary">{detail.earningsSummary}</p>
            ) : null}
            {hasHealth ? (
              <ul className="health-list">
                {health?.profitability ? (
                  <li>
                    <b>収益性</b> {health.profitability}
                  </li>
                ) : null}
                {health?.stability ? (
                  <li>
                    <b>安定性</b> {health.stability}
                  </li>
                ) : null}
                {health?.growth ? (
                  <li>
                    <b>成長性</b> {health.growth}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </details>
        ) : null}

        {detail.trackRecord ? <TrackRecordBlock record={detail.trackRecord} /> : null}
      </section>

      {detail.analyst ? (
        <AnalystBlock consensus={detail.analyst} currentPrice={currentPrice} />
      ) : (
        <section className="sheet-block">
          <h4 className="sheet-title">証券アナリストの見方</h4>
          <p className="sheet-note muted">
            {detail.analystCoverage === 'none'
              ? 'この銘柄を継続的にカバーしている証券アナリストがいません。小型株では珍しくありませんが、第三者の目が入っていないぶん、業績と材料は自分で確かめる必要があります。'
              : 'アナリスト評価を取得できませんでした。下の外部サイトから確認してください。'}
          </p>
        </section>
      )}
    </>
  )
}
