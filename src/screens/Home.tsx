import { BucketRow } from '../components/BucketRow.tsx'
import { GroupSection } from '../components/GroupSection.tsx'
import { ArrowIcon, SettingsIcon } from '../components/Icons.tsx'
import { Eyebrow, Marquee, Money } from '../components/ui.tsx'
import { formatINR } from '../core/index.ts'
import {
  cycleDay,
  formatShortDate,
  inboxItems,
  recentTransactions,
  relativeTime,
  safeToSpendView,
  viewGroups,
  type GroupView,
} from '../data/selectors.ts'
import { findBucket } from '../data/operations.ts'
import { useStore } from '../data/store.tsx'
import type { AppState, Transaction } from '../data/types.ts'
import { navigate } from '../lib/router.ts'
import { useSheets } from '../lib/sheets.tsx'

function marqueeItems(groups: GroupView[]): string[] {
  const items = ['Every rupee has a job']
  for (const { buckets } of groups) {
    for (const view of buckets) {
      if (view.bucket.type === 'committed' && (view.label === 'Paid' || view.label === 'Due soon' || view.label === 'Overdue')) {
        items.push(`${view.bucket.name} ${view.label.toLowerCase()}`)
      }
      if (view.overspent) items.push(`${view.bucket.name} ${formatINR(view.balance)}`)
      if (view.bucket.isBuffer) items.push(`${formatINR(view.balance)} in buffer`)
    }
  }
  return items
}

function bucketName(state: AppState, id: string | null): string | null {
  return findBucket(state, id)?.name ?? null
}

export function ActivityRow({ txn }: { txn: Transaction }) {
  const { state } = useStore()
  const { openTransaction } = useSheets()
  return (
    <button className="activity activity--tap" onClick={() => openTransaction(txn.id)}>
      <span className="activity__main">
        <span className="activity__merchant">{txn.merchant}</span>
        <span className="activity__meta">
          {relativeTime(txn.occurredAt)} ·{' '}
          {txn.status === 'inbox'
            ? 'needs a bucket'
            : txn.status === 'transfer'
              ? 'transfer'
              : txn.status === 'ignored'
                ? 'ignored'
                : bucketName(state, txn.bucketId)}
        </span>
      </span>
      <Money value={txn.direction === 'debit' ? -txn.amount : txn.amount} className={txn.direction === 'credit' ? 'is-credit' : ''} />
    </button>
  )
}

export function Home() {
  const { state, today } = useStore()
  const { openBucket } = useSheets()
  const safe = safeToSpendView(state, today)
  const groups = viewGroups(state, today)
  const { day, length } = cycleDay(state, today)
  const inbox = inboxItems(state)
  const recent = recentTransactions(state)
  const settingUp = state.cycle.income === 0 && state.history.length === 0

  return (
    <div className="screen">
      <div className="topline">
        <Eyebrow>
          {formatShortDate(state.cycle.start)} – {formatShortDate(state.cycle.end)}
        </Eyebrow>
        <span className="topline__actions">
          <span className={`signal ${state.settings.lastSmsAt ? '' : 'is-off'}`}>
            <span className="signal__dot" />
            {state.settings.lastSmsAt ? `SMS ${relativeTime(state.settings.lastSmsAt)}` : 'No SMS yet'}
          </span>
          <button className="icon-button icon-button--line" aria-label="Settings" onClick={() => navigate('/settings')}>
            <SettingsIcon />
          </button>
        </span>
      </div>

      {settingUp && (
        <section className="card setup">
          <Eyebrow>Fresh start</Eyebrow>
          <h2 className="display display--sm">Three steps to go</h2>
          <button className="link-row" onClick={() => navigate('/accounts')}>
            <span className="activity__main">
              <span className="activity__merchant">1 · Your accounts</span>
              <span className="activity__meta">Rename them and set the last 4 digits your bank SMS show</span>
            </span>
            <ArrowIcon />
          </button>
          <button className="link-row" onClick={() => navigate('/plan')}>
            <span className="activity__main">
              <span className="activity__merchant">2 · Your plan</span>
              <span className="activity__meta">Edit, add or remove buckets and their monthly amounts</span>
            </span>
            <ArrowIcon />
          </button>
          <button className="link-row" onClick={() => navigate('/plan/allocate')}>
            <span className="activity__main">
              <span className="activity__merchant">3 · Salary day</span>
              <span className="activity__meta">Check the salary day in Settings, then split your take-home</span>
            </span>
            <ArrowIcon />
          </button>
        </section>
      )}

      <section className="hero">
        <Eyebrow>Safe to spend today</Eyebrow>
        <Money value={Math.floor(safe.today / 100) * 100} className="hero__number" />
        <p className="hero__meta">
          <Money value={safe.remaining} /> flexible · {safe.daysLeft} {safe.daysLeft === 1 ? 'day' : 'days'} left
        </p>
        <div className="sticker" aria-label={`Day ${day} of ${length}`}>
          <span>Day</span>
          <strong>{day}</strong>
          <span>of {length}</span>
        </div>
      </section>

      <Marquee items={marqueeItems(groups)} />

      {inbox.length > 0 && (
        <button className="banner" onClick={() => navigate('/inbox')}>
          <span>
            <strong className="display display--xs">{inbox.length} to sort</strong>
            <span className="banner__sub">One tap each, and the app learns</span>
          </span>
          <ArrowIcon />
        </button>
      )}

      {groups.map(({ group, buckets, total }) => (
        <GroupSection key={group.id} group={group} total={total} count={buckets.length} moods={buckets.map((b) => b.mood)}>
          <div className="card list">
            {buckets.map((view) => (
              <BucketRow key={view.bucket.id} view={view} onOpen={openBucket} />
            ))}
          </div>
        </GroupSection>
      ))}

      <section className="group">
        <header className="group__header">
          <h2 className="display display--sm">Recent</h2>
          <button className="link" onClick={() => navigate('/activity')}>
            See all
          </button>
        </header>
        <div className="card list">
          {recent.map((txn) => (
            <ActivityRow key={txn.id} txn={txn} />
          ))}
          {recent.length === 0 && <p className="empty-line">Nothing yet. Payments appear here as your bank SMS arrive.</p>}
        </div>
      </section>
    </div>
  )
}
