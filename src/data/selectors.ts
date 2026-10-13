import {
  billStatus,
  cardGap,
  committedStatus,
  dateInZone,
  diffDays,
  dueWindowInCycle,
  formatINR,
  safeToSpend,
  sinkingContribution,
  spendingHealth,
  type IsoDate,
  type Paise,
  type SafeToSpend,
} from '../core/index.ts'
import { balanceOfBucket, cardOwed, expectedFor, paidThisCycle } from './operations.ts'
import type { AppState, Group, PlannedBucket, Transaction } from './types.ts'

export type Mood = 'good' | 'warn' | 'bad' | 'calm'

export interface BucketView {
  bucket: PlannedBucket
  balance: Paise
  funded: Paise
  paid: Paise
  expected: Paise
  label: string
  mood: Mood
  /** 0–1 for a progress bar, or null when a bar doesn't make sense. */
  progress: number | null
  detail: string
  dueDate: IsoDate | null
  overspent: boolean
  canMarkPaid: boolean
}

const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

export function formatShortDate(date: IsoDate): string {
  return shortDate.format(new Date(`${date}T00:00:00Z`))
}

export function localDate(state: AppState, iso: string): IsoDate {
  return dateInZone(new Date(iso), state.settings.timezone)
}

function fundedThisCycle(state: AppState, bucketId: string): Paise {
  let funded = 0
  for (const entry of state.ledger) {
    if (entry.cycleId !== state.cycle.id || entry.bucketId !== bucketId || entry.amount <= 0) continue
    if (['allocation', 'opening', 'cover', 'move', 'card_transfer', 'settlement'].includes(entry.kind)) funded += entry.amount
  }
  return funded
}

const committedLabels = { reserved: 'Reserved', due_soon: 'Due soon', partial: 'Partial', paid: 'Paid', overdue: 'Overdue' } as const
const committedMoods = { reserved: 'calm', due_soon: 'warn', partial: 'warn', paid: 'good', overdue: 'bad' } as const
const billLabels = { expected: 'Expected', billed: 'Billed', paid: 'Paid', overdue: 'Overdue' } as const
const billMoods = { expected: 'calm', billed: 'warn', paid: 'good', overdue: 'bad' } as const

export function viewBucket(state: AppState, bucket: PlannedBucket, today: IsoDate): BucketView {
  const balance = balanceOfBucket(state, bucket.id)
  const funded = fundedThisCycle(state, bucket.id)
  const paid = paidThisCycle(state, bucket.id)
  const expected = expectedFor(state, bucket)
  const window = bucket.dueWindow ? dueWindowInCycle(bucket.dueWindow, state.cycle) : null
  const base = { bucket, balance, funded, paid, expected, dueDate: window?.start ?? null, overspent: balance < 0, canMarkPaid: false }

  switch (bucket.type) {
    case 'committed': {
      const status = committedStatus({ expected, paid, tolerance: bucket.amountTolerance, dueWindow: window, today })
      const due = window ? `Due ${formatShortDate(window.start)}${window.end !== window.start ? `–${formatShortDate(window.end)}` : ''}` : 'Any time this cycle'
      const ends = bucket.instalmentsRemaining !== null ? ` · ${bucket.instalmentsRemaining} left` : ''
      return {
        ...base,
        label: committedLabels[status],
        mood: committedMoods[status],
        progress: status === 'partial' ? paid / expected : null,
        detail: status === 'paid' ? `Paid ${formatINR(paid)}${ends}` : status === 'partial' ? `${formatINR(paid)} of ${formatINR(expected)} sent` : `${due}${ends}`,
        canMarkPaid: status !== 'paid',
      }
    }
    case 'bill': {
      const billed = state.billed[bucket.id] ?? null
      const status = billStatus({ billed, paid, dueWindow: window, today })
      return {
        ...base,
        label: billLabels[status],
        mood: billMoods[status],
        progress: null,
        detail: billed === null ? `Estimate ${formatINR(bucket.monthlyAmount)}` : `Bill ${formatINR(billed)} · reserved ${formatINR(bucket.monthlyAmount)}`,
        canMarkPaid: status !== 'paid',
      }
    }
    case 'sinking': {
      const target = bucket.target ?? 0
      const monthly = bucket.targetDueDate
        ? sinkingContribution({ target, balance, cycleStart: state.cycle.start, dueDate: bucket.targetDueDate, cycleStartDay: state.settings.cycleStartDay })
        : 0
      return {
        ...base,
        dueDate: bucket.targetDueDate,
        label: `${Math.round((balance / Math.max(1, target)) * 100)}%`,
        mood: balance >= target ? 'good' : 'calm',
        progress: Math.min(1, Math.max(0, balance / Math.max(1, target))),
        detail: `${formatINR(target)} by ${bucket.targetDueDate ? formatShortDate(bucket.targetDueDate) : '—'} · ${formatINR(monthly)}/mo`,
        canMarkPaid: false,
      }
    }
    case 'flexible': {
      const health = spendingHealth(balance, funded)
      const spent = Math.max(0, funded - balance)
      return {
        ...base,
        label: health === 'overspent' ? 'Over' : health === 'empty' ? 'Empty' : health === 'warning' ? 'Low' : 'On track',
        mood: health === 'overspent' || health === 'empty' ? 'bad' : health === 'warning' ? 'warn' : 'good',
        progress: funded > 0 ? Math.min(1, spent / funded) : 0,
        detail: `${formatINR(spent)} of ${formatINR(funded)} spent`,
      }
    }
    case 'card': {
      const owed = cardOwed(state, bucket)
      const gap = cardGap(balance, owed)
      return {
        ...base,
        label: gap > 0 ? `Gap ${formatINR(gap)}` : owed === 0 ? 'Clear' : 'Covered',
        mood: gap > 0 ? 'bad' : 'good',
        progress: balance > 0 ? Math.min(1, owed / balance) : owed > 0 ? 1 : 0,
        detail: `Owed ${formatINR(owed)} · bill ${window ? formatShortDate(window.start) : '—'}`,
        canMarkPaid: owed > 0,
      }
    }
    case 'surplus':
      return {
        ...base,
        label: bucket.isBuffer ? 'Buffer' : 'Saving',
        mood: balance < 0 ? 'bad' : 'calm',
        progress: null,
        detail: funded > 0 ? `+${formatINR(funded)} this cycle` : 'Holding',
      }
  }
}

export interface GroupView {
  group: Group
  buckets: BucketView[]
  total: Paise
}

export function viewGroups(state: AppState, today: IsoDate): GroupView[] {
  return state.groups
    .map((group) => {
      const buckets = state.buckets.filter((b) => b.groupId === group.id).map((b) => viewBucket(state, b, today))
      return { group, buckets, total: buckets.reduce((sum, b) => sum + b.balance, 0) }
    })
    .filter((g) => g.buckets.length > 0)
}

export function safeToSpendView(state: AppState, today: IsoDate): SafeToSpend {
  const flexible = state.buckets.filter((b) => b.type === 'flexible')
  const flexibleIds = new Set(flexible.map((b) => b.id))
  let spentToday = 0
  for (const entry of state.ledger) {
    if (entry.kind === 'spend' && flexibleIds.has(entry.bucketId) && localDate(state, entry.at) === today) spentToday -= entry.amount
  }
  return safeToSpend({ flexibleBalances: flexible.map((b) => balanceOfBucket(state, b.id)), spentToday, today, cycle: state.cycle })
}

export function cycleDay(state: AppState, today: IsoDate): { day: number; length: number } {
  return { day: diffDays(state.cycle.start, today) + 1, length: diffDays(state.cycle.start, state.cycle.end) + 1 }
}

export function inboxItems(state: AppState): Transaction[] {
  return state.transactions.filter((t) => t.status === 'inbox').sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
}

export function recentTransactions(state: AppState, limit = 6): Transaction[] {
  return state.transactions
    .filter((t) => t.status !== 'ignored')
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, limit)
}

export interface TimelineItem {
  date: IsoDate
  view: BucketView
}

export function timeline(state: AppState, today: IsoDate): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const bucket of state.buckets) {
    const view = viewBucket(state, bucket, today)
    if (!view.dueDate) continue
    if (bucket.type === 'sinking' && view.dueDate > state.cycle.end) continue
    items.push({ date: view.dueDate, view })
  }
  return items.sort((a, b) => a.date.localeCompare(b.date))
}

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return shortDate.format(new Date(iso))
}
