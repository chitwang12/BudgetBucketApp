import { useState } from 'react'
import { BackIcon } from '../components/Icons.tsx'
import { Eyebrow, Money } from '../components/ui.tsx'
import { dateInZone, sum } from '../core/index.ts'
import { allCycles } from '../data/analytics.ts'
import { formatShortDate } from '../data/selectors.ts'
import { useStore } from '../data/store.tsx'
import { navigate } from '../lib/router.ts'
import { ActivityRow } from './Home.tsx'

type Filter = 'all' | 'spent' | 'inbox' | 'ignored'

const dayHeading = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })

export function Activity() {
  const { state } = useStore()
  const cycles = allCycles(state).slice().reverse()
  const [cycleId, setCycleId] = useState(state.cycle.id)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const cycle = cycles.find((c) => c.id === cycleId) ?? state.cycle

  const q = query.trim().toLowerCase()
  const matches = state.transactions
      .filter((t) => {
        const date = dateInZone(new Date(t.occurredAt), state.settings.timezone)
        if (date < cycle.start || date > cycle.end) return false
        if (filter === 'spent' && !(t.status === 'applied' && t.direction === 'debit')) return false
        if (filter === 'inbox' && t.status !== 'inbox') return false
        if (filter === 'ignored' && t.status !== 'ignored') return false
        if (filter === 'all' && t.status === 'ignored') return false
        if (!q) return true
        const bucket = state.buckets.find((b) => b.id === t.bucketId)?.name ?? ''
        return t.merchant.toLowerCase().includes(q) || bucket.toLowerCase().includes(q)
      })
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
  const grouped = new Map<string, typeof matches>()
  for (const txn of matches) {
    const date = dateInZone(new Date(txn.occurredAt), state.settings.timezone)
    grouped.set(date, [...(grouped.get(date) ?? []), txn])
  }
  const days = [...grouped.entries()]

  return (
    <div className="screen">
      <button className="back" onClick={() => navigate('/')}>
        <BackIcon /> Home
      </button>
      <Eyebrow>Tap anything to fix it</Eyebrow>
      <h1 className="display page-title">Activity</h1>

      <div className="chips chips--scroll cycle-chips">
        {cycles.map((c) => (
          <button key={c.id} className={`chip ${c.id === cycle.id ? 'is-active' : ''}`} onClick={() => setCycleId(c.id)}>
            {c.id === state.cycle.id ? 'This cycle' : `${formatShortDate(c.start)} – ${formatShortDate(c.end)}`}
          </button>
        ))}
      </div>

      <input className="text-input search" type="search" placeholder="Search merchant or bucket" value={query} onChange={(e) => setQuery(e.target.value)} />

      <div className="segmented activity-filter" role="radiogroup">
        {(['all', 'spent', 'inbox', 'ignored'] as const).map((f) => (
          <button key={f} role="radio" aria-checked={filter === f} className={`segmented__option ${filter === f ? 'is-active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'spent' ? 'Spent' : f === 'inbox' ? 'Inbox' : 'Deleted'}
          </button>
        ))}
      </div>

      {days.length === 0 && <p className="empty-line">Nothing matches.</p>}
      {days.map(([date, txns]) => (
        <section key={date} className="day-group">
          <header className="day-group__header">
            <span className="eyebrow">{dayHeading.format(new Date(`${date}T00:00:00Z`))}</span>
            <Money value={-sum(txns.filter((t) => t.direction === 'debit' && t.status === 'applied').map((t) => t.amount))} className="day-group__total" />
          </header>
          <div className="card list">
            {txns.map((txn) => (
              <ActivityRow key={txn.id} txn={txn} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
