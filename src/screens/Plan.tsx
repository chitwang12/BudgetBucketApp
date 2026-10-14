import { useState } from 'react'
import { GroupSection } from '../components/GroupSection.tsx'
import { ArrowIcon, PlusIcon } from '../components/Icons.tsx'
import { Eyebrow, Money, PageHeader } from '../components/ui.tsx'
import { formatINR, sum } from '../core/index.ts'
import { useStore } from '../data/store.tsx'
import type { PlannedBucket } from '../data/types.ts'
import { navigate } from '../lib/router.ts'
import { useSheets } from '../lib/sheets.tsx'
import { AddBucketSheet, EditBucketSheet, GroupSheet } from './BucketEditors.tsx'

type Editor = { kind: 'bucket'; id: string } | { kind: 'add'; groupId: string } | { kind: 'group'; id: string | null }

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
  const { state, restoreBucket } = useStore()
  const { toast } = useSheets()
  const [editor, setEditor] = useState<Editor | null>(null)
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
        return (
          <GroupSection key={group.id} group={group} count={buckets.length} total={sum(buckets.map((b) => b.monthlyAmount))}>
            <div className="card list">
              {buckets.map((bucket) => (
                <button key={bucket.id} className="plan-row" onClick={() => setEditor({ kind: 'bucket', id: bucket.id })}>
                  <span className="activity__main">
                    <span className="activity__merchant">{bucket.name}</span>
                    <span className="activity__meta">{planLine(bucket)}</span>
                  </span>
                  <Money value={bucket.type === 'sinking' ? (bucket.target ?? 0) : bucket.monthlyAmount} />
                </button>
              ))}
              <div className="plan-actions">
                <button className="plan-actions__add" onClick={() => setEditor({ kind: 'add', groupId: group.id })}>
                  <PlusIcon /> Add bucket
                </button>
                <button className="link" onClick={() => setEditor({ kind: 'group', id: group.id })}>
                  Edit group
                </button>
              </div>
            </div>
          </GroupSection>
        )
      })}

      <button className="add-tile add-tile--spaced" onClick={() => setEditor({ kind: 'group', id: null })}>
        <PlusIcon />
        <span>New group</span>
      </button>

      {state.archivedBuckets.length > 0 && (
        <section className="group">
          <header className="group__header">
            <h2 className="display display--sm">Archived</h2>
            <span className="eyebrow">{state.archivedBuckets.length}</span>
          </header>
          <div className="card list">
            {state.archivedBuckets.map((bucket) => (
              <div key={bucket.id} className="activity">
                <span className="activity__main">
                  <span className="activity__merchant">{bucket.name}</span>
                  <span className="activity__meta">History kept · not in the plan</span>
                </span>
                <button
                  className="link link--inline"
                  onClick={() => {
                    restoreBucket(bucket.id)
                    toast(`${bucket.name} is back in the plan`)
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

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

      {editor?.kind === 'bucket' && <EditBucketSheet key={editor.id} bucketId={editor.id} onClose={() => setEditor(null)} />}
      {editor?.kind === 'add' && <AddBucketSheet key={editor.groupId} groupId={editor.groupId} onClose={() => setEditor(null)} />}
      {editor?.kind === 'group' && <GroupSheet key={editor.id ?? 'new'} groupId={editor.id} onClose={() => setEditor(null)} />}
    </div>
  )
}
