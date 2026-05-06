import type { AnalysisResult } from '../../shared/types'

interface ExplainabilityPanelProps {
  result: AnalysisResult
}

function ContributionList({
  title,
  items,
}: {
  title: string
  items: AnalysisResult['featureImportance']
}) {
  return (
    <section className="panel">
      <div className="panel-heading compact">
        <p className="eyebrow">説明可能性</p>
        <h3>{title}</h3>
      </div>
      <div className="contribution-list">
        {items.length === 0 ? <p className="empty-copy">データなし</p> : null}
        {items.map((item) => (
          <article key={`${title}-${item.feature}`} className="contribution-item">
            <div className="contribution-copy">
              <p>{item.feature}</p>
              <span>{item.valueText}</span>
            </div>
            <div className="contribution-bar">
              <div
                className={`contribution-fill direction-${item.direction}`}
                style={{ width: `${Math.min(100, Math.abs(item.score) * 140)}%` }}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export function ExplainabilityPanel({ result }: ExplainabilityPanelProps) {
  return (
    <div className="tab-stack">
      <ContributionList title="特徴量重要度" items={result.featureImportance} />
      <ContributionList title="最新データへの寄与度" items={result.localContributions} />
    </div>
  )
}
