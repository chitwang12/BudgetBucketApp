import { describe, expect, it } from 'vitest'
import { draftAllocation, rupees } from '../core/index.ts'
import { buildReports, insights, merchantStats, pace, planVsActual, weekdayPattern } from './analytics.ts'
import { createDemoState } from './mockData.ts'
import { safeToSpendView, viewGroups } from './selectors.ts'
import {
  addManualTransaction,
  freshStart,
  startCycle,
  addAccount,
  addBucket,
  addGroup,
  amountDue,
  balanceOfBucket,
  deleteTransaction,
  editTransaction,
  markPaid,
  moveGroup,
  moveMoney,
  paymentAccountsFor,
  recategorise,
  removeAccount,
  removeBucket,
  removeGroup,
  restoreBucket,
  returnToInbox,
  undoMove,
} from './operations.ts'

const today = '2026-10-13'
const now = '2026-10-13T06:00:00.000Z'
const state = createDemoState(today)
const swiggy = state.transactions.find((t) => t.merchant === 'SWIGGY' && t.occurredAt.startsWith('2026-10-12'))!

describe('corrections', () => {
  it('moves a spend to another bucket and restores the first one', () => {
    const next = recategorise(state, swiggy.id, 'misc')
    expect(balanceOfBucket(next, 'eating_out')).toBe(balanceOfBucket(state, 'eating_out') + rupees(450))
    expect(balanceOfBucket(next, 'misc')).toBe(balanceOfBucket(state, 'misc') - rupees(450))
    expect(next.transactions.find((t) => t.id === swiggy.id)?.bucketId).toBe('misc')
  })

  it('edits an amount and rewrites the ledger', () => {
    const next = editTransaction(state, swiggy.id, { amount: rupees(400) })
    expect(balanceOfBucket(next, 'eating_out')).toBe(balanceOfBucket(state, 'eating_out') + rupees(50))
  })

  it('deletes an SMS transaction but keeps it as ignored so it is not imported again', () => {
    const next = deleteTransaction(state, swiggy.id)
    expect(balanceOfBucket(next, 'eating_out')).toBe(balanceOfBucket(state, 'eating_out') + rupees(450))
    expect(next.transactions.find((t) => t.id === swiggy.id)?.status).toBe('ignored')
  })

  it('reverses a card swipe on both the category and the card reserve', () => {
    const toit = state.transactions.find((t) => t.merchant === 'TOIT BREWPUB' && t.occurredAt >= '2026-10-05')!
    const next = returnToInbox(state, toit.id)
    expect(balanceOfBucket(next, 'card')).toBe(balanceOfBucket(state, 'card') - rupees(810))
    expect(next.transactions.find((t) => t.id === toit.id)?.status).toBe('inbox')
  })

  it('undoes a manual move as one action', () => {
    const moved = moveMoney(state, 'buffer', 'groceries', rupees(500), now)
    const moveId = moved.ledger.at(-1)!.moveId!
    expect(balanceOfBucket(moved, 'groceries')).toBe(balanceOfBucket(state, 'groceries') + rupees(500))
    expect(balanceOfBucket(undoMove(moved, moveId), 'groceries')).toBe(balanceOfBucket(state, 'groceries'))
  })
})

describe('buckets and groups', () => {
  const input = {
    name: 'Pet care',
    groupId: 'g-flex',
    type: 'flexible' as const,
    monthlyAmount: rupees(1_200),
    dueWindow: null,
    target: null,
    targetDueDate: null,
    matchKeywords: [],
  }

  it('adds a bucket and funds it from the buffer', () => {
    const next = addBucket(state, input, rupees(1_200), now)
    const pet = next.buckets.at(-1)!
    expect(pet).toMatchObject({ name: 'Pet care', groupId: 'g-flex', type: 'flexible' })
    expect(balanceOfBucket(next, pet.id)).toBe(rupees(1_200))
    expect(balanceOfBucket(next, 'buffer')).toBe(balanceOfBucket(state, 'buffer') - rupees(1_200))
  })

  it('deletes an untouched bucket and hands its money back to the buffer', () => {
    const added = addBucket(state, input, 0, now)
    const pet = added.buckets.at(-1)!
    const removed = removeBucket(added, pet.id, now)
    expect(removed.buckets.some((b) => b.id === pet.id)).toBe(false)
    expect(removed.archivedBuckets).toHaveLength(0)
  })

  it('archives a bucket with history, returns its balance and can restore it', () => {
    const fuelBalance = balanceOfBucket(state, 'fuel')
    const next = removeBucket(state, 'fuel', now)
    expect(next.buckets.some((b) => b.id === 'fuel')).toBe(false)
    expect(next.archivedBuckets.map((b) => b.id)).toEqual(['fuel'])
    expect(next.rules.some((r) => r.bucketId === 'fuel')).toBe(false)
    expect(balanceOfBucket(next, 'buffer')).toBe(balanceOfBucket(state, 'buffer') + fuelBalance)
    expect(buildReports(next, today).at(-2)!.spentByBucket.get('fuel')).toBeGreaterThan(0)
    expect(restoreBucket(next, 'fuel').buckets.some((b) => b.id === 'fuel')).toBe(true)
  })

  it('keeps the buffer and card buckets', () => {
    expect(removeBucket(state, 'buffer', now)).toBe(state)
    expect(removeBucket(state, 'card', now)).toBe(state)
  })

  it('adds, reorders and removes only empty groups', () => {
    const added = addGroup(state, 'Kids', 'teal')
    const kids = added.groups.at(-1)!
    expect(moveGroup(added, kids.id, -1).groups.at(-2)!.id).toBe(kids.id)
    expect(removeGroup(added, kids.id).groups.some((g) => g.id === kids.id)).toBe(false)
    expect(removeGroup(state, 'g-flex')).toBe(state)
  })
})

describe('marking paid', () => {
  it('records the payment against the account you chose', () => {
    const rent = state.buckets.find((b) => b.id === 'rent')!
    const due = amountDue(state, rent)
    const next = markPaid(state, 'rent', now, { accountId: 'acc-hdfc', amount: due })
    expect(next.transactions[0]).toMatchObject({ accountId: 'acc-hdfc', amount: due, bucketId: 'rent', status: 'applied' })
    expect(amountDue(next, rent)).toBe(0)
  })

  it('never offers a credit card to pay a card bill', () => {
    const card = state.buckets.find((b) => b.id === 'card')!
    expect(paymentAccountsFor(state, card).some((a) => a.kind === 'card')).toBe(false)
  })
})

describe('accounts', () => {
  it('adds a card together with its bill bucket', () => {
    const next = addAccount(state, { name: 'HDFC Millennia', kind: 'card', last4: '4455', card: { monthlyReserve: rupees(3_000), billDay: 18 } })
    const account = next.accounts.at(-1)!
    expect(next.buckets.find((b) => b.cardAccountId === account.id)).toMatchObject({ type: 'card', monthlyAmount: rupees(3_000) })
    const removed = removeAccount(next, account.id)
    expect(removed.accounts.some((a) => a.id === account.id)).toBe(false)
    expect(removed.buckets.some((b) => b.cardAccountId === account.id)).toBe(false)
  })

  it('archives an account that has history instead of deleting it', () => {
    const next = removeAccount(state, 'acc-hdfc')
    expect(next.accounts.find((a) => a.id === 'acc-hdfc')?.active).toBe(false)
  })
})

describe('analytics', () => {
  const reports = buildReports(state, today)

  it('reports every closed cycle plus the current one', () => {
    expect(reports).toHaveLength(7)
    const last = reports.at(-2)!
    expect(last.byGroup.committed).toBeGreaterThanOrEqual(rupees(26_000) - rupees(10))
    expect(last.outflow + last.leftOver).toBe(last.income)
  })

  it('tracks pace for the current cycle', () => {
    const current = reports.at(-1)!
    const { spent } = pace(current)
    expect(current.elapsed).toBe(9)
    expect(spent).toBe(rupees(620 + 280 + 1_000 + 700 + 810 + 780 + 450 + 60))
  })

  it('flags eating out as running over and suggests a realistic plan', () => {
    const eating = planVsActual(state, reports).find((r) => r.bucket.id === 'eating_out')!
    expect(eating.overCount).toBeGreaterThanOrEqual(4)
    expect(eating.suggestion).toBeGreaterThan(rupees(1_500))
  })

  it('ranks merchants and weekdays and writes insights', () => {
    expect(merchantStats(state, state.history)[0].total).toBeGreaterThan(0)
    expect(weekdayPattern(reports.slice(0, -1))).toHaveLength(7)
    const notes = insights(state, reports)
    expect(notes.some((n) => n.title.includes('Eating out runs over'))).toBe(true)
    expect(notes.some((n) => n.title.includes('late'))).toBe(true)
  })
})

describe('fresh start', () => {
  const fresh = freshStart(state, today)

  it('keeps the plan and clears everything that happened', () => {
    expect(fresh.buckets).toEqual(state.buckets)
    expect(fresh.accounts).toEqual(state.accounts)
    expect(fresh.groups).toEqual(state.groups)
    expect(fresh.rules.length).toBeGreaterThan(0)
    expect(fresh.transactions).toEqual([])
    expect(fresh.ledger).toEqual([])
    expect(fresh.history).toEqual([])
    expect(fresh.cycle.income).toBe(0)
    expect(fresh.buckets.every((b) => balanceOfBucket(fresh, b.id) === 0)).toBe(true)
  })

  it('does not record the empty waiting period as a past month', () => {
    const lines = draftAllocation(rupees(60_000), fresh.buckets, { cycleStart: today, cycleStartDay: fresh.settings.cycleStartDay, balances: new Map() })
    const started = startCycle(fresh, today, rupees(60_000), lines, now)
    expect(started.history).toEqual([])
    expect(started.cycle.income).toBe(rupees(60_000))
  })

  it('keeps a waiting period in which money moved', () => {
    const withSpend = addManualTransaction(fresh, { amount: rupees(100), merchant: 'Chai', bucketId: 'misc', accountId: 'acc-cash', direction: 'debit', occurredAt: now })
    const lines = draftAllocation(rupees(60_000), fresh.buckets, { cycleStart: today, cycleStartDay: fresh.settings.cycleStartDay, balances: new Map() })
    const started = startCycle(withSpend, today, rupees(60_000), lines, now)
    expect(started.history).toHaveLength(1)
  })

  it('shows every screen without data', () => {
    expect(viewGroups(fresh, today).length).toBeGreaterThan(0)
    expect(safeToSpendView(fresh, today).today).toBe(0)
    const reports = buildReports(fresh, today)
    expect(() => {
      pace(reports[reports.length - 1])
      planVsActual(fresh, reports)
      weekdayPattern(reports)
      insights(fresh, reports)
      merchantStats(fresh, [fresh.cycle])
    }).not.toThrow()
  })
})
