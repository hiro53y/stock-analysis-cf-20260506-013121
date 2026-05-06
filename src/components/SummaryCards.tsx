import type { SummaryCardData } from '../../shared/types'

interface SummaryCardsProps {
  cards: SummaryCardData[]
}

export function SummaryCards({ cards }: SummaryCardsProps) {
  return (
    <div className="summary-grid">
      {cards.map((card) => (
        <article key={card.id} className={`summary-card tone-${card.tone}`}>
          <p className="summary-label">{card.label}</p>
          <p className="summary-value">{card.value}</p>
          <p className="summary-subtext">{card.subText}</p>
        </article>
      ))}
    </div>
  )
}
