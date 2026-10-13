import { describe, expect, it } from 'vitest'
import { rupees } from './money.ts'
import { safeToSpend } from './safeToSpend.ts'
import { billStatus, cardGap, committedStatus, spendingHealth } from './status.ts'

const rentWindow = { start: '2026-11-01', end: '2026-11-03' }
const rent = { expected: rupees(12_000), tolerance: 0, dueWindow: rentWindow }

describe('committed status', () => {
  it('moves from reserved to due soon to overdue', () => {
    expect(committedStatus({ ...rent, paid: 0, today: '2026-10-20' })).toBe('reserved')
    expect(committedStatus({ ...rent, paid: 0, today: '2026-10-29' })).toBe('due_soon')
    expect(committedStatus({ ...rent, paid: 0, today: '2026-11-04' })).toBe('overdue')
  })

  it('shows partial until the expected total is reached', () => {
    const family = { expected: rupees(5_000), tolerance: 0, dueWindow: null, today: '2026-10-20' }
    expect(committedStatus({ ...family, paid: rupees(2_000) })).toBe('partial')
    expect(committedStatus({ ...family, paid: rupees(5_000) })).toBe('paid')
  })

  it('accepts a payment within tolerance as paid', () => {
    expect(committedStatus({ ...rent, tolerance: rupees(50), paid: rupees(11_990), today: '2026-11-02' })).toBe('paid')
  })

  it('tracks bills from estimate to bill to payment', () => {
    const base = { dueWindow: null, today: '2026-10-20' }
    expect(billStatus({ ...base, billed: null, paid: 0 })).toBe('expected')
    expect(billStatus({ ...base, billed: rupees(1_240), paid: 0 })).toBe('billed')
    expect(billStatus({ ...base, billed: rupees(1_240), paid: rupees(1_240) })).toBe('paid')
  })
})

describe('spending health', () => {
  it('warns at 80% spent, goes red at zero and shows overspending', () => {
    expect(spendingHealth(rupees(1_000), rupees(4_000))).toBe('ok')
    expect(spendingHealth(rupees(800), rupees(4_000))).toBe('warning')
    expect(spendingHealth(0, rupees(4_000))).toBe('empty')
    expect(spendingHealth(-rupees(600), rupees(4_000))).toBe('overspent')
  })

  it('reports the gap when the card owes more than its reserve', () => {
    expect(cardGap(rupees(5_000), rupees(6_200))).toBe(rupees(1_200))
    expect(cardGap(rupees(5_000), rupees(4_000))).toBe(0)
  })
})

describe('safe to spend today', () => {
  const cycle = { start: '2026-10-05', end: '2026-11-04' }

  it('divides flexible money by days left', () => {
    const result = safeToSpend({ flexibleBalances: [rupees(4_000), rupees(2_200)], spentToday: 0, today: '2026-10-25', cycle })
    expect(result).toEqual({ remaining: rupees(6_200), daysLeft: 11, today: 56_363 })
  })

  it("subtracts today's spending instead of re-dividing", () => {
    const result = safeToSpend({ flexibleBalances: [rupees(6_100)], spentToday: rupees(500), today: '2026-10-25', cycle })
    expect(result.today).toBe(rupees(100))
  })

  it('lets overspent buckets pull the number down', () => {
    const result = safeToSpend({ flexibleBalances: [rupees(1_000), -rupees(1_600)], spentToday: 0, today: '2026-10-25', cycle })
    expect(result.remaining).toBe(-rupees(600))
    expect(result.today).toBe(-rupees(600))
  })
})
