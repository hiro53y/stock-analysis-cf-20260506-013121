import type { MarketNewsItem } from '../../shared/types'

interface MarketNewsProps {
  items: MarketNewsItem[]
}

export function MarketNews({ items }: MarketNewsProps) {
  if (items.length === 0) return null

  return (
    <section className="panel news-panel">
      <div className="panel-heading compact news-heading">
        <h3>市場ニュース</h3>
        <span className="news-more">参考情報</span>
      </div>
      <ul className="news-list">
        {items.map((item) => (
          <li key={item.id} className="news-item">
            <div className="news-body">
              <p className="news-title">{item.title}</p>
              <p className="news-summary">{item.summary}</p>
            </div>
            <span className="news-time">{item.time}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
