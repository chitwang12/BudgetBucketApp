import { Fragment } from 'react'
import { Money, PageHeader, Pill } from '../components/ui.tsx'
import { parseIsoDate } from '../core/index.ts'
import { formatShortDate, timeline } from '../data/selectors.ts'
import { useStore } from '../data/store.tsx'

const monthShort = new Intl.DateTimeFormat('en-IN', { month: 'short' })
const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short' })

export function Timeline({ onOpenBucket }: { onOpenBucket: (bucketId: string) => void }) {
  const { state, today } = useStore()
  const items = timeline(state, today)
  const todayIndex = items.findIndex((item) => item.date >= today)
  const markerAt = todayIndex === -1 ? items.length : todayIndex

  return (
    <div className="screen">
      <PageHeader eyebrow={`${formatShortDate(state.cycle.start)} – ${formatShortDate(state.cycle.end)}`} title="Timeline" />
      <ol className="timeline">
        {items.map((item, index) => {
          const date = new Date(`${item.date}T00:00:00Z`)
          return (
            <Fragment key={item.view.bucket.id}>
              {index === markerAt && <TodayMarker />}
              <li className={`timeline__item ${item.date < today ? 'is-past' : ''}`}>
                <div className="timeline__date">
                  <span className="display display--md">{parseIsoDate(item.date).d}</span>
                  <span className="eyebrow">
                    {monthShort.format(date)} · {weekday.format(date)}
                  </span>
                </div>
                <button className="card timeline__card" onClick={() => onOpenBucket(item.view.bucket.id)}>
                  <span className="timeline__name">{item.view.bucket.name}</span>
                  <span className="timeline__row">
                    <Money value={item.view.bucket.type === 'card' ? item.view.balance : item.view.expected} />
                    <Pill mood={item.view.mood}>{item.view.label}</Pill>
                  </span>
                </button>
              </li>
            </Fragment>
          )
        })}
        {markerAt === items.length && <TodayMarker />}
      </ol>
    </div>
  )
}

function TodayMarker() {
  return (
    <li className="timeline__today" aria-label="Today">
      <span>Today</span>
    </li>
  )
}
