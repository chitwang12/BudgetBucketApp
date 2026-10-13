import { useState } from 'react'
import { GroupSection } from '../components/GroupSection.tsx'
import { ArrowIcon } from '../components/Icons.tsx'
import { MoneyInput } from '../components/MoneyInput.tsx'
import { Eyebrow, Money, PageHeader, Sheet } from '../components/ui.tsx'
import { formatINR, sum } from '../core/index.ts'
import { useStore } from '../data/store.tsx'
import type { PlannedBucket } from '../data/types.ts'
import { navigate } from '../lib/router.ts'

const typeLabels: Record<PlannedBucket['type'], string> = {
  committed: 'Committed',
  bill: 'Bill',
  sinking: 'Sinking fund',
  flexible: 'Flexible',
  card: 'Card',
  surplus: 'Surplus',
}

function ordinal(day: number): string {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'
  return `${day}${suffix}`
}

function planLine(bucket: PlannedBucket): string {
  const parts = [typeLabels[bucket.type]]
  if (bucket.dueWindow) {
    const { startDay, endDay } = bucket.dueWindow
    parts.push(startDay === endDay ? `due on the ${ordinal(startDay)}` : `due ${ordinal(startDay)}–${ordinal(endDay)}`)
  }
  if (bucket.instalmentsRemaining !== null) parts.push(`${bucket.instalmentsRemaining} instalments left`)
  if (bucket.type === 'sinking' && bucket.target) parts.push(`${formatINR(bucket.target)} target`)
  return parts.join(' · ')
}

export function Plan() {
  const { state } = useStore()
  const [editing, setEditing] = useState<string | null>(null)
  const planned = sum(state.buckets.filter((b) => b.type !== 'sinking').map((b) => b.monthlyAmount))

  return (
    <div className="screen">
      <PageHeader eyebrow="Monthly plan" title="Plan" />

      <button className="cta" onClick={() => navigate('/plan/allocate')}>
        <span>
          <span className="eyebrow">Salary landed?</span>
          <span className="display display--md">Start salary day</span>
        </span>
        <ArrowIcon />
      </button>

      <div className="stat-row">
        <div className="stat">
          <Eyebrow>Planned / month</Eyebrow>
          <Money value={planned} className="stat__value" />
        </div>
        <div className="stat">
          <Eyebrow>Cycle starts</Eyebrow>
          <span className="stat__value">Day {state.settings.cycleStartDay}</span>
        </div>
      </div>

      <button className="link-row card" onClick={() => navigate('/accounts')}>
        <span className="activity__main">
          <span className="activity__merchant">Accounts & cards</span>
          <span className="activity__meta">{state.accounts.filter((a) => a.active).length} active · add a card, bank or wallet</span>
        </span>
        <ArrowIcon />
      </button>

      {state.groups.map((group) => {
        const buckets = state.buckets.filter((b) => b.groupId === group.id)
        if (buckets.length === 0) return null
        return (
          <GroupSection key={group.id} group={group} count={buckets.length} total={sum(buckets.map((b) => b.monthlyAmount))}>
            <div className="card list">
              {buckets.map((bucket) => (
                <button key={bucket.id} className="plan-row" onClick={() => setEditing(bucket.id)}>
                  <span className="activity__main">
                    <span className="activity__merchant">{bucket.name}</span>
                    <span className="activity__meta">{planLine(bucket)}</span>
                  </span>
                  <Money value={bucket.type === 'sinking' ? (bucket.target ?? 0) : bucket.monthlyAmount} />
                </button>
              ))}
            </div>
          </GroupSection>
        )
      })}

      <section className="group">
        <header className="group__header">
          <h2 className="display display--sm">Merchant rules</h2>
          <span className="eyebrow">{state.rules.length}</span>
        </header>
        <div className="card list">
          {state.rules.map((rule) => (
            <div key={rule.id} className="activity">
              <span className="activity__merchant">“{rule.pattern}”</span>
              <span className="activity__meta">→ {state.buckets.find((b) => b.id === rule.bucketId)?.name}</span>
            </div>
          ))}
        </div>
      </section>

      {editing && <EditBucketSheet key={editing} bucketId={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function EditBucketSheet({ bucketId, onClose }: { bucketId: string; onClose: () => void }) {
  const { state, updateBucket } = useStore()
  const bucket = state.buckets.find((b) => b.id === bucketId)
  const [amount, setAmount] = useState(bucket?.type === 'sinking' ? (bucket.target ?? 0) : (bucket?.monthlyAmount ?? 0))
  const [keywords, setKeywords] = useState(bucket?.matchKeywords.join(', ') ?? '')
  const [startDay, setStartDay] = useState(bucket?.dueWindow?.startDay ?? 0)
  const [endDay, setEndDay] = useState(bucket?.dueWindow?.endDay ?? 0)
  if (!bucket) return null

  const hasWindow = ['committed', 'bill', 'card'].includes(bucket.type)
  const save = () => {
    updateBucket(bucket.id, {
      ...(bucket.type === 'sinking' ? { target: amount } : { monthlyAmount: amount }),
      matchKeywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
      dueWindow: hasWindow && startDay > 0 ? { startDay, endDay: Math.max(startDay, endDay || startDay) } : bucket.dueWindow,
    })
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={bucket.name}>
      <Eyebrow>{bucket.type === 'sinking' ? 'Target' : 'Monthly amount'}</Eyebrow>
      <MoneyInput value={amount} onChange={setAmount} size="lg" label="Amount" />
      {hasWindow && (
        <div className="field-row">
          <label className="field">
            <Eyebrow>Due from day</Eyebrow>
            <input className="text-input" inputMode="numeric" value={startDay || ''} onChange={(e) => setStartDay(Math.min(31, Number(e.target.value) || 0))} />
          </label>
          <label className="field">
            <Eyebrow>To day</Eyebrow>
            <input className="text-input" inputMode="numeric" value={endDay || ''} onChange={(e) => setEndDay(Math.min(31, Number(e.target.value) || 0))} />
          </label>
        </div>
      )}
      {bucket.type !== 'flexible' && bucket.type !== 'surplus' && (
        <label className="field">
          <Eyebrow>SMS keywords</Eyebrow>
          <input className="text-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="landlord, rent" />
        </label>
      )}
      <button className="button button--ink button--block" onClick={save}>
        Save
      </button>
    </Sheet>
  )
}
