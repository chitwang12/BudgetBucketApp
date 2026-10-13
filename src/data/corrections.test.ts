import { describe, expect, it } from 'vitest'
import { rupees } from '../core/index.ts'
import { buildReports, insights, merchantStats, pace, planVsActual, weekdayPattern } from './analytics.ts'
import { createDemoState } from './mockData.ts'
import {
  addAccount,
  balanceOfBucket,
  deleteTransaction,
  editTransaction,
  moveMoney,
  recategorise,
  removeAccount,
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
